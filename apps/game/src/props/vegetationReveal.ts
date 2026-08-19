/**
 * REVELAÇÃO DE VEGETAÇÃO — reduz a obstrução visual de árvores que estão
 * perto do personagem ou no corredor câmera→personagem, sem transparência
 * tradicional e sem tocar em material por árvore.
 *
 * Extensão do MESMO padrão que `props/grass/grassMaterial.ts` já usa (dither/
 * discard no shader, patch único de `onBeforeCompile` compartilhado por
 * espécie) — não é um segundo sistema de fade, é o mesmo mecanismo aplicado a
 * uma categoria (`tree`/`tree_bare`) que hoje não tem fade nenhum, só corte
 * binário por raio (`instanciasVisiveisNaCamada`).
 *
 * Tudo aqui é PURO (sem `THREE.*`, sem `<Canvas>`) — mesma régua de
 * `instanciasVisiveisNaCamada`: a decisão é testável sem GPU, só a ESCRITA no
 * buffer (em `VegetationInstancer.tsx: CamadaDeEspecie`) toca em Three.js.
 *
 * ## Por que não raycast
 *
 * Raycast contra geometria real custa por TRIÂNGULO testado e por árvore.
 * Aqui a pergunta não é "esta árvore está exatamente na frente do pixel do
 * personagem", é "esta árvore está perto o bastante do corredor
 * câmera→personagem pra atrapalhar a leitura" — um teste geométrico 2D
 * (projeção num segmento de reta, distância perpendicular) resolve isso por
 * uma fração do custo, sem tocar em geometria nenhuma.
 *
 * ## Por que não every frame
 *
 * A pergunta "quais árvores são candidatas" só muda de resultado quando o
 * personagem anda ou a câmera gira — coisas que acontecem numa escala de
 * dezenas de ms, não de 16ms. `retickTargets` (a parte cara: um `hypot`/
 * `smoothstep` por candidata) roda só em `REVEAL_CONFIG.updateHz`;
 * `advanceAndUpload` (a parte barata: um lerp por slot JÁ RASTREADO) roda
 * todo quadro, mas só sobre o conjunto pequeno em `trackedSlots` — nunca
 * sobre todas as instâncias da espécie.
 *
 * ## Upload parcial pra GPU (3º tuning — desempenho)
 *
 * `advanceAndUpload` devolve o INTERVALO de slots tocado neste quadro (não só
 * um booleano). `CamadaDeEspecie` usa isso com `BufferAttribute.
 * addUpdateRange` — o `bufferSubData` do WebGL sobe só os bytes daquele
 * intervalo, não o array inteiro da espécie. Com `trackedSlots` tipicamente
 * disperso em dezenas de slots dentro de uma capacidade de centenas, isso é
 * upload de KB, não de dezenas de KB, por quadro que muda.
 */

export interface RevealConfig {
  /** raio (unidades de mundo) em que a Player Reveal Zone está em força total */
  revealRadius: number;
  /** raio em que a Player Reveal Zone já não tem efeito nenhum (fade linear-suave entre os dois) */
  revealRadiusOuter: number;
  /** meia-largura (unidades de mundo) do corredor câmera→personagem */
  corridorHalfWidth: number;
  /** raio (unidades de mundo) ao redor do PERSONAGEM — pré-filtro barato antes de qualquer outro teste */
  candidateRadius: number;
  /**
   * Distância câmera↔personagem (mundo) ABAIXO da qual o peso ao longo do
   * corredor mantém o afinamento de hoje (mais forte perto do personagem,
   * quase nada perto da câmera) — câmera no zoom neutro não muda de
   * comportamento.
   */
  corridorFullFadeNear: number;
  /**
   * Distância câmera↔personagem a partir da qual o corredor já desbota em
   * FORÇA TOTAL do início ao fim, sem afinar perto da câmera — câmera muito
   * afastada não deixa mais nenhuma árvore do caminho "passar barato" só por
   * estar longe do personagem (era o "queria ir pra trás da copa, mas com o
   * zoom bem aberto a árvore continua atrapalhando" reportado ao vivo).
   */
  corridorFullFadeFar: number;
  /** frequência (Hz) da reavaliação de candidatas/alvo — não é por quadro */
  updateHz: number;
  /** taxa (1/s) da suavização exponencial current→target — maior reage mais rápido */
  smoothingRate: number;
  /** fade máximo (0..1) — teto de `instanceFade`; com a máscara vertical em 1.0 no topo/tronco alto, é
   * essencialmente a opacidade de descarte no pior caso (0,98 ≈ "praticamente invisível") */
  maxFade: number;
  /** peso mínimo do fade na BASE do tronco (0..1) — pequeno de propósito, nunca some de vez */
  trunkFadeFraction: number;
  /** fração de altura (0..1, do bounding box da malha) ONDE o fade começa a subir acima de
   * `trunkFadeFraction` — abaixo disto fica no peso mínimo, achatado (o "toco" que sobra visível) */
  canopyFadeStart: number;
  /** fração de altura (0..1) a partir da qual o peso já é 1.0 (platô no topo) —
   * entre `canopyFadeStart` e este valor a transição é suave (smoothstep/hermite) */
  canopyFadeFull: number;
}

/**
 * 3º tuning (pedido explícito): "só uma parte do tronco aparece, o resto da
 * árvore fica transparente" — `canopyFadeStart`/`canopyFadeFull` baixos, o
 * platô mínimo (toco visível) só cobre os primeiros 12% da altura da malha,
 * e por 28% já é fade máximo (tronco médio/alto + copa inteira).
 *
 * 4º tuning (feedback visual ao vivo): `maxFade` subiu pra 1,0 — em 0,98
 * sobrava ~2% dos pixels desenhados mesmo no platô máximo da copa, e é
 * JUSTAMENTE esse resíduo esparso que lia como "pontilhado" mesmo depois de
 * trocar o ruído branco por Bayer ordenado (`treeRevealMaterial.ts`): Bayer
 * deixa o PADRÃO mais regular, mas não tira o resíduo — só `maxFade=1,0`
 * garante descarte de 100% onde `canopyWeight` já é 1,0. O tronco não é
 * afetado (`trunkFadeFraction` continua baixo, então a base nunca chega
 * perto de 1,0 de qualquer forma). Alcance (`revealRadius`/
 * `revealRadiusOuter`/`candidateRadius`) também ampliado — pedido explícito
 * de "começar um pouco antes".
 *
 * Único lugar que define estes números — nada disto deve ser hardcoded de
 * novo em `VegetationInstancer.tsx` ou no shader (o shader lê os mesmos
 * valores via `treeRevealMaterial.ts: revealShaderUniforms`, compartilhados
 * — mudar aqui em DEV, pelo console (`window.__revelacao.config`), reflete
 * SEM recompilar nenhum programa).
 */
export const REVEAL_CONFIG: RevealConfig = {
  revealRadius: 8.0,
  revealRadiusOuter: 13.0,
  corridorHalfWidth: 2.2,
  candidateRadius: 24.0,
  // cameraDistance neutro é 16 (server-config.ts); 70 fica bem antes do
  // alcance máximo de zoom (~110, `FollowCamera`/`HorizonMesh`), então o
  // corredor já está em força total bem antes do jogador chegar no fim do
  // scroll
  corridorFullFadeNear: 16.0,
  corridorFullFadeFar: 70.0,
  updateHz: 15,
  smoothingRate: 8,
  maxFade: 1.0,
  trunkFadeFraction: 0.03,
  canopyFadeStart: 0.12,
  canopyFadeFull: 0.28,
};

/** Hermite smoothstep — MESMA curva que a `smoothstep()` nativa do GLSL usa
 * (`treeRevealMaterial.ts` chama a builtin do shader, não esta função; estão
 * aqui lado a lado só porque a fórmula tem que ser idêntica dos dois lados). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Peso do fade por ALTURA FRACIONÁRIA da malha (0 = base do tronco, 1 =
 * topo da copa) — máscara vertical: limiar + transição suave.
 *
 * - `h <= canopyFadeStart`: platô no mínimo (`trunkFadeFraction`) — só o
 *   "toco" da base fica preservado por igual, sem gradiente ali.
 * - `canopyFadeStart < h < canopyFadeFull`: transição Hermite (smoothstep) —
 *   suave nas DUAS pontas (derivada zero), sem quina visível na malha.
 * - `h >= canopyFadeFull`: platô no máximo (1,0) — combinado com
 *   `maxFade≈0,98`, é o "resto da árvore fica transparente" do pedido.
 *
 * ESPELHO DA GLSL: `treeRevealMaterial.ts` implementa a MESMA equação
 * (`mix(uTrunkFadeFraction, 1.0, smoothstep(uCanopyFadeStart, uCanopyFadeFull,
 * hFrac))`) com a `smoothstep` NATIVA do shader — esta função existe só para
 * dar cobertura de TESTE à curva (GLSL não roda em `vitest`). Mudar uma
 * fórmula sem mudar a outra é bug silencioso: se alterar aqui, altere lá.
 */
export function canopyWeightForHeight(heightFraction: number, cfg: RevealConfig = REVEAL_CONFIG): number {
  const t = smoothstep(cfg.canopyFadeStart, cfg.canopyFadeFull, heightFraction);
  return cfg.trunkFadeFraction + (1 - cfg.trunkFadeFraction) * t;
}

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Fade-alvo (0..cfg.maxFade) de UMA posição — puro, testável sem instância
 * nenhuma de árvore de verdade.
 *
 * `Math.max(reveal, corridor)`, não soma: as duas razões pedem fade pelo
 * MESMO motivo (legibilidade do personagem), então a mais forte já cobre a
 * mais fraca — somar dobraria o fade de uma árvore que está nas duas
 * situações ao mesmo tempo, sem motivo visual pra isso.
 */
export function computeTargetFade(inst: Vec2, player: Vec2, camera: Vec2, cfg: RevealConfig = REVEAL_CONFIG): number {
  const dx = inst.x - player.x;
  const dz = inst.z - player.z;
  const distToPlayer = Math.hypot(dx, dz);

  // Player Reveal Zone: 1 dentro de `revealRadius`, esvazia até `revealRadiusOuter`
  const reveal = 1 - smoothstep(cfg.revealRadius, cfg.revealRadiusOuter, distToPlayer);

  // corredor câmera→personagem: projeção no segmento + distância perpendicular
  const segX = player.x - camera.x;
  const segZ = player.z - camera.z;
  const segLen2 = segX * segX + segZ * segZ;
  let corridor = 0;
  /**
   * SEM corte por `distToPlayer` aqui (o de antes cortava a função inteira
   * antes de testar corredor): uma árvore no meio do corredor
   * câmera→personagem, com a câmera afastada, fica bem além de
   * `candidateRadius` do personagem mesmo estando exatamente no caminho —
   * cortava o teste de corredor antes dele nem rodar. `candidateRadius`
   * continua valendo só para a Player Reveal Zone (via `smoothstep` em
   * `reveal`, que já satura em 0 sozinho).
   */
  if (segLen2 > 1e-6) {
    const t = ((inst.x - camera.x) * segX + (inst.z - camera.z) * segZ) / segLen2;
    // t em (0, ~1]: entre a câmera e o personagem (folga de 5% além do
    // personagem — árvore rente atrás dele ainda conta como "no caminho")
    if (t > 0 && t < 1.05) {
      const px = camera.x + segX * t;
      const pz = camera.z + segZ * t;
      const perp = Math.hypot(inst.x - px, inst.z - pz);
      const lateral = 1 - smoothstep(0, cfg.corridorHalfWidth, perp);
      /**
       * Peso ao longo do corredor: no zoom NEUTRO (`corridorFullFadeNear`),
       * mantém o afinamento de sempre — mais forte perto do personagem,
       * quase nada perto da câmera (`smoothstep(0,1,t)`). Conforme a câmera
       * se afasta até `corridorFullFadeFar`, esse afinamento se dissolve
       * num peso UNIFORME (1.0 do início ao fim do corredor) — câmera muito
       * longe não deixa mais nenhuma árvore "perto da câmera" passar
       * barato só por estar longe do personagem.
       */
      const cameraDist = Math.sqrt(segLen2);
      const zoomFactor = smoothstep(cfg.corridorFullFadeNear, cfg.corridorFullFadeFar, cameraDist);
      const taperedWeight = smoothstep(0, 1, t);
      const alongWeight = taperedWeight + (1 - taperedWeight) * zoomFactor;
      corridor = lateral * alongWeight;
    }
  }

  return Math.max(reveal, corridor) * cfg.maxFade;
}

/** uma instância candidata — já filtrada por quem está desenhando no raio de detalhe (ver CamadaDeEspecie) */
export interface RevealCandidate extends Vec2 {
  /** índice do slot de instância (`setMatrixAt`) — é a chave que liga de volta ao buffer de GPU */
  slot: number;
}

/**
 * Estado persistente por CAMADA (espécie) — vive num `useRef` em
 * `CamadaDeEspecie`, nunca recriado por quadro.
 *
 * `trackedSlots` é o que mantém `advanceAndUpload` barato: só cresce quando
 * uma árvore vira candidata de verdade, só encolhe quando o fade dela já
 * chegou a zero de novo — nunca itera a capacidade inteira da espécie.
 */
export interface RevealState {
  target: Float32Array;
  current: Float32Array;
  trackedSlots: Set<number>;
  /** acumulador de tempo (s) até o próximo `retickTargets` */
  accumulator: number;
}

export function createRevealState(capacity: number): RevealState {
  return {
    target: new Float32Array(capacity),
    current: new Float32Array(capacity),
    trackedSlots: new Set<number>(),
    accumulator: 0,
  };
}

/**
 * Parte CARA (um `computeTargetFade` por candidata) — só chamada em
 * `updateHz`, nunca por quadro.
 *
 * Zera o alvo de quem estava rastreado antes de recalcular: uma árvore que
 * SAIU da lista de candidatas (jogador se afastou) precisa decair de volta a
 * zero, não travar no último valor.
 */
export function retickTargets(
  state: RevealState,
  candidates: readonly RevealCandidate[],
  player: Vec2,
  camera: Vec2,
  cfg: RevealConfig = REVEAL_CONFIG,
): void {
  for (const slot of state.trackedSlots) state.target[slot] = 0;
  for (const c of candidates) {
    const t = computeTargetFade(c, player, camera, cfg);
    if (t > 0) {
      state.target[c.slot] = t;
      state.trackedSlots.add(c.slot);
    }
  }
}

const SETTLE_EPS = 0.002;

/** resultado de um avanço: `changed=false` = nada pra subir à GPU. Com
 * `changed=true`, `minSlot..maxSlot` é o intervalo CONTÍGUO (por índice) que
 * cobre todos os slots tocados neste quadro — usado pra upload parcial
 * (`BufferAttribute.addUpdateRange`) em vez do array inteiro. */
export interface UploadResult {
  changed: boolean;
  minSlot: number;
  maxSlot: number;
}

/**
 * Parte BARATA (um lerp por slot rastreado) — roda todo quadro, mas só sobre
 * `trackedSlots` (tipicamente dezenas, nunca a espécie inteira).
 *
 * Suavização exponencial (`1 - exp(-rate*dt)`), não `lerp(cur,tgt,rate)`
 * fixo: assim a velocidade de aproximação não depende do framerate (mesmo
 * `smoothingRate` produz a mesma curva a 30fps e a 144fps).
 */
export function advanceAndUpload(state: RevealState, dt: number, out: Float32Array, cfg: RevealConfig = REVEAL_CONFIG): UploadResult {
  if (state.trackedSlots.size === 0) return { changed: false, minSlot: 0, maxSlot: 0 };
  const rate = 1 - Math.exp(-cfg.smoothingRate * dt);
  let changed = false;
  let minSlot = Infinity;
  let maxSlot = -Infinity;
  for (const slot of state.trackedSlots) {
    const cur = state.current[slot]!;
    const tgt = state.target[slot]!;
    const next = cur + (tgt - cur) * rate;
    if (Math.abs(next - cur) > 1e-5) {
      changed = true;
      if (slot < minSlot) minSlot = slot;
      if (slot > maxSlot) maxSlot = slot;
    }
    const settled = tgt === 0 && Math.abs(next) < SETTLE_EPS;
    const finalValue = settled ? 0 : next;
    state.current[slot] = finalValue;
    out[slot] = finalValue;
    if (settled) state.trackedSlots.delete(slot);
  }
  return changed ? { changed, minSlot, maxSlot } : { changed: false, minSlot: 0, maxSlot: 0 };
}

/**
 * Um quadro inteiro do sistema: throttling do retick + avanço barato — a
 * função que `CamadaDeEspecie` chama de dentro do `useFrame`.
 *
 * `getCandidates` é uma FUNÇÃO, não um array pronto: montar a lista de
 * candidatas (varrer `visiveis` da espécie e projetar posição de mundo) tem
 * custo O(instâncias ativas) — barato, mas não GRÁTIS, e não pode rodar todo
 * quadro só para ser descartado. Só é chamada quando o acumulador já decidiu
 * que este É o quadro do retick.
 *
 * `state.accumulator %= interval` (não `= 0`) preserva o resto: sem isso, a
 * cadência real deriva pra baixo de `updateHz` sempre que um quadro não bate
 * exatamente no múltiplo do intervalo (quase sempre).
 */
export function tickRevealFade(
  state: RevealState,
  dt: number,
  getCandidates: () => readonly RevealCandidate[],
  player: Vec2,
  camera: Vec2,
  out: Float32Array,
  cfg: RevealConfig = REVEAL_CONFIG,
): UploadResult {
  const interval = 1 / cfg.updateHz;
  state.accumulator += dt;
  if (state.accumulator >= interval) {
    state.accumulator %= interval;
    const t0 = revealStats.amostrar ? performance.now() : 0;
    const candidatos = getCandidates();
    retickTargets(state, candidatos, player, camera, cfg);
    if (revealStats.amostrar) {
      const n = candidatos.length;
      revealStats.ultimoRetickCandidatos = n;
      revealStats.maxRetickCandidatos = Math.max(revealStats.maxRetickCandidatos, n);
      revealStats.amostrasRetick++;
      revealStats.mediaRetickCandidatos += (n - revealStats.mediaRetickCandidatos) / revealStats.amostrasRetick;
      revealStats.ultimoRetickMs = performance.now() - t0;
    }
  }
  revealStats.slotsRastreados = state.trackedSlots.size;
  return advanceAndUpload(state, dt, out, cfg);
}

/**
 * Instrumentação DEV — mesma régua de `window.__vento`/`window.__iso`
 * (props/wind.ts, core/diagnostics/isolamento.ts): inspeção manual/benchmark
 * durante teste A/B, zero custo em produção quando `amostrar` fica `false`
 * (o default). Não agrega por espécie — é o ÚLTIMO tick de QUALQUER camada
 * que chamou `tickRevealFade`, suficiente pra confirmar ordem de grandeza
 * (candidatas avaliadas, slots ativos) sem instrumentar cada espécie.
 */
export const revealStats = {
  amostrar: false,
  ultimoRetickCandidatos: 0,
  maxRetickCandidatos: 0,
  mediaRetickCandidatos: 0,
  amostrasRetick: 0,
  ultimoRetickMs: 0,
  slotsRastreados: 0,
  /** referência (não cópia) — mudar um campo aqui pelo console reflete no
   * PRÓXIMO retick (`REVEAL_CONFIG` é lido por valor de campo, não clonado),
   * sem recarregar a página nem recompilar shader nenhum */
  config: REVEAL_CONFIG,
};

/** zera os contadores de amostragem (não mexe em `config`) — chamar antes de cada rodada de benchmark */
export function resetRevealStats(): void {
  revealStats.ultimoRetickCandidatos = 0;
  revealStats.maxRetickCandidatos = 0;
  revealStats.mediaRetickCandidatos = 0;
  revealStats.amostrasRetick = 0;
  revealStats.ultimoRetickMs = 0;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __revelacao?: unknown }).__revelacao = revealStats;
}
