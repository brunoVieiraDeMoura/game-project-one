import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { clampToWindow, serverToLocal, type LegacyMapping } from "../net/legacyCells";
import { ehCelulaDeAgua } from "../grid/squareChunks";
import { getSfxVolume, useAudioSettings } from "./audioSettingsStore";

/**
 * Passo por tipo de superfície — reusa a MESMA precedência de `squareChunks`
 * (`cellColor`/`cellLayer`/`ehCelulaDeAgua`): superfície autorada manda
 * (menos "grass", que é o valor de preenchimento), senão o tipo de colisão
 * decide. Nenhuma classificação nova — só o mesmo dado lido para outro fim.
 *
 * `wood` não existe no `SurfaceTypeSchema` (`packages/map-format/src/
 * index.ts:14`: `"grass" | "dirt" | "stone" | "sand" | "snow" | "water" |
 * "river"`) — não há célula "madeira" para classificar hoje.
 *
 * A ÚNICA noção de "madeira" que existe no projeto é a categoria de prop
 * `"bridge"` (`props/registry.tsx: isBridgeProp`/`propCategory`), e ela NÃO
 * SERVE para isto por dois motivos, confirmados lendo o próprio arquivo:
 *  1. É geometria de prop (o TABULEIRO da ponte, medido do `.gltf` —
 *     `hx`/`hz`/`y` do próprio comentário do arquivo), não uma entrada de
 *     `SurfaceType` — nunca passa por `surface[]`/`cellLayer`, então não tem
 *     como `surfaceAt` (nem `squareChunks`) enxergar. "Andar sobre uma
 *     ponte" seria descobrir se a posição cai dentro do polígono do
 *     tabuleiro de CADA prop-ponte perto do jogador a cada quadro — uma
 *     consulta geométrica nova, não uma leitura de dado que já existe.
 *  2. Só é usada pela query de terreno HEXAGONAL (`createHexTerrainQuery`,
 *     mundo do editor/`/spectator`). O mapa real (`terrainMode: "square"`,
 *     caso de `prt_fild08`) importado do `map_cache.dat` carrega
 *     `props: []` (ver `grid/squareChunks.ts` e o `CLAUDE.md`) — mesmo se a
 *     consulta geométrica acima fosse construída, não haveria NENHUMA ponte
 *     para ela achar neste mapa hoje.
 *
 * Ou seja: a limitação não é só "falta um valor no enum" — é que a fonte de
 * dado que poderia alimentar "madeira" (props de ponte) não existe pra este
 * mapa, e o mecanismo que ela usa noutros mapas é geometria de prop, não
 * classificação de célula. Alterar `SurfaceTypeSchema` sozinho não resolveria
 * nada sem essa consulta geométrica nova — por isso não mexo no schema aqui.
 * O asset (`madeira-run-walk.mp3`) está copiado em
 * `public/assets/audio/footsteps/`, pronto para o dia em que essa consulta
 * existir.
 */
const FOOTSTEP_SRC: Partial<Record<SurfaceType, string>> = {
  grass: "/assets/audio/footsteps/grama-run-walk.mp3",
  dirt: "/assets/audio/footsteps/terra-running-walk.mp3",
  // areia não tem asset dedicado no pedido — soa como terra, o vizinho mais
  // próximo, em vez de ficar muda
  sand: "/assets/audio/footsteps/terra-running-walk.mp3",
  stone: "/assets/audio/footsteps/concrete-floor-running-walk.mp3",
  snow: "/assets/audio/footsteps/neve-running-walk.mp3",
  water: "/assets/audio/footsteps/water-running-walk.mp3",
  river: "/assets/audio/footsteps/water-running-walk.mp3",
};

/** um `<audio>` por SOM (nunca um por passo) — reaproveitado por toda a sessão */
const pool = new Map<string, HTMLAudioElement>();

function elementFor(src: string): HTMLAudioElement {
  let el = pool.get(src);
  if (!el) {
    el = new Audio(src);
    el.loop = true;
    pool.set(src, el);
  }
  return el;
}

/**
 * `src` do loop TOCANDO agora, ou `null` parado — é o "moving" do lado do
 * áudio. Módulo-singleton (como `mapAmbience.Canal`): sobrevive a
 * remontagens do `NetPlayer` (StrictMode, warp) sem duplicar `<audio>`.
 */
let tocando: string | null = null;

/** troca de volume nas Configurações aplica no loop TOCANDO agora, sem
 * esperar a próxima troca de superfície */
useAudioSettings.subscribe(() => {
  if (tocando === null) return;
  const el = pool.get(tocando);
  if (el) el.volume = getSfxVolume();
});

/** Superfície de uma célula — mesma regra de `grid/squareChunks: cellLayer`. */
export function surfaceAt(map: GameMap, idx: number): SurfaceType {
  if (ehCelulaDeAgua(map, idx)) return map.surface[idx] === "river" ? "river" : "water";
  const surface = map.surface[idx];
  if (surface && surface !== "grass") return surface;
  return map.collision[idx] === "cliff" ? "dirt" : "grass";
}

/** para o loop tocando, se houver — usado tanto ao parar quanto ao trocar de som */
function pararFootstep(): void {
  if (tocando === null) return;
  const el = pool.get(tocando);
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  tocando = null;
}

/**
 * Atualiza o loop de passo para o quadro atual do `NetPlayer` — chamar todo
 * `useFrame` com o `moving` e a célula JÁ conhecidos ali (`interpolatedCell`),
 * NUNCA um timer à parte: quem decide anda/parado é o mesmo estado que já
 * decide a animação (`cell.moving`, ver `NetPlayer`).
 *
 * `moving = false` PARA imediatamente (pausa, não espera o áudio terminar).
 * `moving = true` toca (ou mantém) o loop da superfície atual — troca de
 * faixa só quando ela muda de verdade, nunca a cada célula cruzada nem a cada
 * quadro: `tocando === src` sai cedo sem tocar no `<audio>`.
 */
export function footstepFrame(
  moving: boolean,
  map: GameMap,
  mapping: LegacyMapping,
  serverX: number,
  serverY: number,
): void {
  if (!moving) {
    pararFootstep();
    return;
  }
  const local = serverToLocal(mapping, serverX, serverY);
  const { col, row } = clampToWindow(mapping, local.col, local.row);
  const idx = cellIndex(map, col, row);
  const src = FOOTSTEP_SRC[surfaceAt(map, idx)];
  if (!src) {
    pararFootstep();
    return;
  }
  if (tocando === src) return; // mesmo som já em loop — nada a fazer

  // início do movimento OU troca de superfície: nunca dois tocando juntos
  pararFootstep();
  const el = elementFor(src);
  el.currentTime = 0;
  el.volume = getSfxVolume();
  el.play().catch(() => {
    /* mesma rede de segurança de sempre — passo só ocorre depois de já ter
       havido interação (clique pra andar), então autoplay não deveria
       bloquear aqui */
  });
  tocando = src;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __footsteps?: () => { tocando: string | null } }).__footsteps = () => ({ tocando });
}

/**
 * SÓ PARA TESTE — o app de verdade nunca chama isto. `pool`/`tocando` são
 * módulo-singleton de propósito (sobrevive a remontagens do `NetPlayer`), o
 * que exige um jeito de zerar entre casos de teste sem inventar uma segunda
 * instância do módulo por arquivo de teste.
 */
export function __resetForTests(): void {
  pararFootstep();
  pool.clear();
}
