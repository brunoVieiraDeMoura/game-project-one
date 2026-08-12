import * as THREE from "three";
import { SKY_TOP } from "../scene/skyGradient.glsl";

/**
 * BAKE DE IMPOSTOR — gera a imagem 2D de uma espécie de árvore a partir do
 * `.gltf` REAL dela, para o atlas que `TreeImpostors.tsx` usa no horizonte.
 *
 * Mesma técnica de `editor/thumbnailer.ts` (renderer offscreen dedicado +
 * canvas transparente) — não um mecanismo novo, uma segunda instância dela,
 * deliberadamente SEPARADA da do thumbnailer por dois motivos que tornariam
 * o compartilhamento direto errado, não só redundante:
 *
 * 1. **Ângulo de câmera é outro.** O thumbnailer usa 3/4 perspectiva (bonito
 *    para um botão de paleta). Impostor é visto de FRENTE, sempre virado pra
 *    câmera (billboard) — a foto tem de ser a silhueta de frente, ortográfica,
 *    enquadrando a base (chão) até o topo da copa, senão a proporção
 *    altura/largura do billboard não bate com a foto colada nele.
 * 2. **Tonemapping NÃO pode entrar no bake — só no display, e só UMA vez.**
 *    O `<Canvas>` do jogo (`PlayView.tsx`) liga `ACESFilmicToneMapping`
 *    (padrão do R3F) com `toneMappingExposure: 1.25`; o material do
 *    billboard (`TreeImpostors.tsx`) é um material normal da cena e passa
 *    pela MESMA curva ao ser desenhado. Se o bake TAMBÉM aplicasse ACES ao
 *    gravar os pixels do atlas, a curva seria aplicada DUAS vezes na árvore
 *    distante (bake + display) e só UMA na árvore 3D real ao lado dela — as
 *    duas ficariam com contraste/saturação visivelmente diferentes bem na
 *    linha da troca. Por isso este renderer NUNCA seta `toneMapping`
 *    (fica `NoToneMapping`, o default do three, de propósito): o atlas grava
 *    a cor "crua" (só linear→sRGB, sem curva fílmica), e o material do
 *    billboard aplica ACES uma vez só — a MESMA vez que todo resto da cena
 *    aplica.
 *
 * O QUE é reaproveitado de verdade: a árvore real (mesmo `.gltf`, mesmas
 * texturas de casca/folha, mesmo `alphaMode: MASK` do catálogo Quaternius) —
 * só a câmera/luz do BAKE são outros (estúdio próprio, não a luz do mapa: o
 * bake não sabe em que mapa a árvore vai parar). Se o asset mudar, o
 * impostor muda junto na próxima vez que o mapa carregar.
 *
 * ## SÍNCRONO, e por que isso importa (bug corrigido)
 *
 * A versão original recebia a URL e carregava com um `GLTFLoader` PRÓPRIO,
 * separado do cache do `useGLTF`/`preloadPropsDoMapa` — ou seja, toda
 * espécie era buscada e reanalisada da rede DE NOVO, ainda que o mesmo
 * `.gltf` já estivesse carregado (e em uso pelos props reais) na cena.
 * Medido ao vivo (`voo-1786561281881.json`, sessão com cache frio): **41
 * SEGUNDOS** para bakear 22 espécies — era isso que fazia o jogo "entrar
 * rápido mas demorar pra esquentar": o atlas de árvore/arbusto no horizonte
 * só ficava pronto minutos depois do jogador já ter controle.
 *
 * Agora `bakeSpeciesImage` recebe a CENA JÁ CARREGADA (o `TreeImpostors.tsx`
 * chamador usa o MESMO `useGLTF` que os props reais, já pré-carregado por
 * `preloadPropsDoMapa`) — nenhuma rede, nenhum parse, só o render da foto.
 * Isso também elimina o `await` por espécie: a função inteira é síncrona,
 * então bakear 30 espécies vira 30 chamadas de função comuns num laço, não
 * 30 promessas encadeadas — o motivo de existir "sequencial" (compartilhar
 * UM renderer offscreen) continua valendo, só que agora sequencial é RÁPIDO.
 */

const CELL = 128;

let renderer: THREE.WebGLRenderer | null = null;

function ensureRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(CELL, CELL);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // `toneMapping` FICA no default (`NoToneMapping`) — de propósito, não
    // esquecimento. Ver o comentário do módulo: aplicar ACES aqui E no
    // material do billboard dobraria a curva de tom.
  }
  return renderer;
}

export interface BakedSpecies {
  /** canvas 128×128, fundo transparente, a árvore de frente da base ao topo */
  canvas: HTMLCanvasElement;
  /** largura real do modelo (maior entre X e Z do bounding box), unidades de mundo */
  width: number;
  /** altura real do modelo (Y do bounding box), unidades de mundo */
  height: number;
}

/**
 * Cache por CENA (a mesma instância que o `useGLTF` devolve pra uma URL —
 * estável entre renders mesmo quando o ARRAY que a embrulha não é).
 *
 * Existe porque `useGLTF(urls)` (drei) devolve um ARRAY NOVO a cada render,
 * mesmo com `urls` de conteúdo igual — sem este cache, `TreeImpostors`
 * rebakearia TODAS as espécies de novo toda vez que `PlayView` re-renderiza
 * por qualquer motivo (o `useMemo` de `buildTreeAtlas` está atrás desse
 * array instável). Bakear já ficou rápido (~1-2 ms/espécie, sem rede), mas
 * repetir sem necessidade ainda aloca canvas/textura à toa — `WeakMap` pela
 * CENA em vez de por url porque esta função não recebe url nenhuma, só o
 * objeto já carregado, e a identidade dele já é a chave que importa.
 */
const cache = new WeakMap<THREE.Object3D, BakedSpecies>();

/**
 * Renderiza UMA espécie (cena de `.gltf` JÁ CARREGADA, do cache do
 * `useGLTF`) numa foto de frente, ortográfica, fundo transparente — e
 * devolve, de brinde, o tamanho REAL medido do bounding box (mesma
 * varredura que já precisa rodar para enquadrar a câmera). É esse tamanho
 * que dimensiona o billboard no mundo — não um palpite fixo tipo "altura =
 * 2,4× a largura" da versão anterior.
 *
 * `cenaFonte.clone(true)` — nunca a cena original: ela é COMPARTILHADA (o
 * mesmo objeto que `VegetationInstancer`/`PropInstance` usam pros props
 * reais), e este bake não pode mexer nela nem descartar a geometria dela no
 * fim (só o clone, que não é dono de recurso GPU nenhum — `Object3D.clone`
 * copia a hierarquia, geometria/material continuam por REFERÊNCIA).
 */
export function bakeSpeciesImage(cenaFonte: THREE.Object3D): BakedSpecies {
  const pronto = cache.get(cenaFonte);
  if (pronto) return pronto;
  const gl = ensureRenderer();
  const obj = cenaFonte.clone(true);

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, size.z) || 0.5;
  const height = size.y || 1;
  const midY = (box.min.y + box.max.y) / 2;
  const midX = (box.min.x + box.max.x) / 2;
  const midZ = (box.min.z + box.max.z) / 2;

  const scene = new THREE.Scene();
  scene.add(obj);
  // luz de estúdio simples (não a do mundo — o bake não sabe em que mapa vai
  // parar): hemisfério pra nunca ir a preto puro + um sol raso pra dar volume
  // à casca/copa, mesma régua de `HemisphereLight` que a cena principal usa
  scene.add(new THREE.HemisphereLight(SKY_TOP, "#8a7d64", 2.4));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(2.2, 3.2, 3.4);
  scene.add(sol);

  // câmera ORTOGRÁFICA de frente: enquadra da base (0) ao topo (height),
  // centrada em X — ortográfica, não perspectiva, porque o billboard vai
  // colar esta imagem num quad plano sem distorção de perspectiva nenhuma
  const margem = 1.08;
  const halfW = (width / 2) * margem;
  const halfH = (height / 2) * margem;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);
  const dist = Math.max(width, height) * 3 + 1;
  cam.position.set(midX, midY, midZ + dist);
  cam.lookAt(midX, midY, midZ);

  gl.render(scene, cam);

  const canvas = document.createElement("canvas");
  canvas.width = CELL;
  canvas.height = CELL;
  // copia direto do canvas WebGL pro canvas 2D — sem toDataURL/Image
  // (round-trip por base64 é desnecessário quando os dois canvas estão na
  // mesma página; drawImage entre canvas é síncrono e mais barato)
  canvas.getContext("2d")!.drawImage(gl.domElement, 0, 0);

  // NADA pra descartar aqui: `obj` é um CLONE (`Object3D.clone`), e
  // geometria/material dele são as MESMAS referências do cache do
  // `useGLTF` — descartá-las quebraria todo mundo que também aponta pra
  // elas (props reais, outras espécies do atlas). `scene` (o wrapper local
  // criado acima) não é dona de recurso GPU nenhum, só agrupa por um
  // instante — não precisa de dispose, só sair de escopo.
  const resultado = { canvas, width, height };
  cache.set(cenaFonte, resultado);
  return resultado;
}
