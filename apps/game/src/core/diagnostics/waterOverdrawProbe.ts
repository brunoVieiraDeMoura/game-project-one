import * as THREE from "three";

/**
 * SONDA DE OVERDRAW DE ÁGUA — instrumentação, não otimização (`render-tecnic.txt`
 * seção 22.11, item 2 da fila de prioridade da seção 26).
 *
 * ## Por que existe
 *
 * A auditoria de render (regra 44 do pedido original: nunca otimizar sem
 * medir) aponta água translúcida como a fonte MAIS ÓBVIA de overdraw
 * (`render-tecnic.txt` seção 16), mas classifica isso como
 * `[NÃO MEDIDO/NÃO INSTRUMENTADO]` — não existia ferramenta nenhuma pra
 * confirmar se o problema é real ou só teórico. Este módulo é essa
 * ferramenta: DEV apenas, sob demanda (`__overdrawAgua()` no console, mesmo
 * padrão de `__censo()`), nunca roda em produção nem no caminho quente.
 *
 * ## O que "overdraw de água" significa aqui — e o que NÃO significa
 *
 * Água-sobre-CHÃO (1 draw de terreno opaco + 1 draw de água translúcida por
 * cima) é ESPERADO e não é o alvo desta sonda — é o preço normal de
 * qualquer superfície translúcida, `depthWrite:false` de propósito
 * (`SquareTerrain.tsx`, `makeWaterMaterial`). O que a sonda mede é
 * água-sobre-ÁGUA: quantas vezes o MESMO pixel de tela é coberto por MAIS DE
 * UMA malha de água — cada chunk com água tem a própria malha
 * (`buildWaterGeometry`, uma por chunk), e como `depthWrite:false` também
 * vale entre elas, duas malhas de água que se sobrepõem na tela (margem de
 * lago numa encosta, corpo d'água visto de ângulo raso perto de um degrau)
 * se somam sem que nenhuma bloqueie a outra no buffer de profundidade —
 * geometricamente elas nunca ocupam a MESMA célula do mapa (grade fixa, uma
 * célula = uma malha), mas podem se sobrepor EM TELA por perspectiva.
 *
 * ## Como mede
 *
 * Não lê o quadro real (mudar o material da água ao vivo alteraria o que o
 * jogador vê). Constrói uma CENA À PARTE, com meshes RASOS (mesma
 * geometria — compartilhada por referência, nunca clonada — e mesma
 * `matrixWorld`) de toda malha de água encontrada na cena real
 * (`<group name="agua">`, o mesmo rótulo que `SquareTerrain.tsx` já usa pro
 * flight recorder separar chão de lâmina), com um material ADITIVO
 * (`AdditiveBlending`, `depthTest:false`) que soma exatamente 1,0 por
 * fragmento desenhado — sem depender do que está por baixo. Renderiza essa
 * cena-sombra num alvo OFFSCREEN de ponto flutuante (`FloatType`, sem isso o
 * alvo padrão de 8 bits SATURARIA em 1,0 no primeiro fragmento e nunca
 * distinguiria 1 camada de 3), lê os pixels de volta e soma um histograma —
 * cada canal R vale o número de camadas de água que tocaram aquele pixel.
 *
 * Resolução baixa de propósito (`RESOLUCAO = 256`): a pergunta é "existe
 * overdraw, e quanto da tela ele cobre", uma ESTATÍSTICA, não uma imagem —
 * 256×256 já dá ~65 mil amostras, generoso pra essa pergunta, e é rápido o
 * bastante pra rodar sem travar o quadro que o chama.
 *
 * ## O que NÃO faz
 *
 * Não mede overdraw água-sobre-CHÃO (não é o alvo, ver acima). Não mede
 * custo de GPU em milissegundos (isso é `EXT_disjoint_timer_query_webgl2`,
 * se o driver expuser — fora do escopo desta sonda, que é sobre CONTAGEM de
 * camada, não tempo). Não corre em produção (chamado só sob demanda pelo
 * console, nunca registrado em `useFrame`).
 */

export interface RelatorioOverdrawAgua {
  /** quantas malhas de água (uma por chunk com água) existem na cena agora */
  malhasDeAgua: number;
  /** de `RESOLUCAO²` amostras, quantas tinham pelo menos 1 camada de água na tela */
  pixelsComAgua: number;
  /** dessas, quantas tinham 2+ camadas — o overdraw de verdade (água-sobre-água) */
  pixelsComOverdraw: number;
  /** maior número de camadas sobrepostas encontrado em qualquer amostra */
  overdrawMaximo: number;
  /** média de camadas, só entre os pixels que tinham água (não dilui com o resto da tela vazia) */
  overdrawMedioNosPixelsComAgua: number;
  /** fração de `pixelsComAgua` que tinha overdraw — a métrica de resumo mais direta */
  fracaoComOverdraw: number;
  resolucao: number;
}

const RESOLUCAO = 256;
/** abaixo disto é ruído de amostragem/blend, não uma camada real */
const LIMIAR_PRESENCA = 0.05;
/** acima disto já é ≥2 camadas inteiras (1 camada = 1.0 exato, com folga pra arredondamento de ponto flutuante) */
const LIMIAR_OVERDRAW = 1.5;

/**
 * Acha toda malha de água viva na cena — mesmo rótulo (`"agua"`) que
 * `SquareTerrain.tsx` usa pro flight recorder. Exportada (não só usada por
 * `medirOverdrawDeAgua`) pra ser testável sem WebGL — a parte que PRECISA de
 * `<Canvas>` real é só o render offscreen, não a coleta.
 */
export function coletarMalhasDeAgua(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if (obj.name !== "agua") return;
    obj.traverse((filho) => {
      const m = filho as THREE.Mesh & { isMesh?: boolean };
      if (m.isMesh) out.push(m);
    });
  });
  return out;
}

/**
 * Mede o overdraw de água na cena/câmera ATUAL — pura o bastante pra ser
 * chamada a qualquer momento sem deixar rastro (a cena real nunca é tocada;
 * só uma cena-sombra temporária, descartada no fim da própria chamada).
 *
 * Devolve `null` se não houver água nenhuma na cena (nada pra medir).
 */
export function medirOverdrawDeAgua(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): RelatorioOverdrawAgua | null {
  const malhasDeAgua = coletarMalhasDeAgua(scene);
  if (malhasDeAgua.length === 0) return null;

  const materialContagem = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });

  // cena-sombra: meshes RASOS com a MESMA geometria (referência, nunca clone
  // — não é dona do recurso, não faz dispose dela) e a MESMA matrizWorld já
  // resolvida da cena real, só pra existir um instante fora dela
  const cenaSombra = new THREE.Scene();
  for (const m of malhasDeAgua) {
    m.updateWorldMatrix(true, false);
    const copia = new THREE.Mesh(m.geometry, materialContagem);
    copia.matrixAutoUpdate = false;
    copia.matrix.copy(m.matrixWorld);
    cenaSombra.add(copia);
  }

  // alvo de PONTO FLUTUANTE: um alvo padrão (8 bits/canal) satura em 1,0 no
  // primeiro fragmento aditivo e nunca mais distingue 1 camada de 3 — é
  // exatamente a pergunta que esta sonda existe pra responder
  const alvo = new THREE.WebGLRenderTarget(RESOLUCAO, RESOLUCAO, {
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const alvoAnterior = renderer.getRenderTarget();
  const corDeFundoAnterior = new THREE.Color();
  renderer.getClearColor(corDeFundoAnterior);
  const alphaDeFundoAnterior = renderer.getClearAlpha();

  renderer.setRenderTarget(alvo);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(cenaSombra, camera);
  renderer.setRenderTarget(alvoAnterior);
  renderer.setClearColor(corDeFundoAnterior, alphaDeFundoAnterior);

  const buf = new Float32Array(RESOLUCAO * RESOLUCAO * 4);
  renderer.readRenderTargetPixels(alvo, 0, 0, RESOLUCAO, RESOLUCAO, buf);

  let pixelsComAgua = 0;
  let pixelsComOverdraw = 0;
  let overdrawMaximo = 0;
  let somaOverdraw = 0;
  for (let i = 0; i < RESOLUCAO * RESOLUCAO; i++) {
    const v = buf[i * 4]!; // branco aditivo — R/G/B sempre iguais, 1 canal basta
    if (v <= LIMIAR_PRESENCA) continue;
    pixelsComAgua++;
    somaOverdraw += v;
    if (v > overdrawMaximo) overdrawMaximo = v;
    if (v > LIMIAR_OVERDRAW) pixelsComOverdraw++;
  }

  alvo.dispose();
  materialContagem.dispose();

  return {
    malhasDeAgua: malhasDeAgua.length,
    pixelsComAgua,
    pixelsComOverdraw,
    overdrawMaximo: Math.round(overdrawMaximo * 100) / 100,
    overdrawMedioNosPixelsComAgua: pixelsComAgua > 0 ? Math.round((somaOverdraw / pixelsComAgua) * 100) / 100 : 0,
    fracaoComOverdraw: pixelsComAgua > 0 ? Math.round((pixelsComOverdraw / pixelsComAgua) * 1000) / 1000 : 0,
    resolucao: RESOLUCAO,
  };
}
