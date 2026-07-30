/**
 * Geometria do grid hexagonal (KayKit Medieval Hexagon). Tiles pointy-top,
 * layout offset "odd-r" (linhas ímpares deslocadas meia coluna). Medidas do
 * modelo NATIVO (escala 1): bbox X=2.0, Z=2.309 → size (centro→canto) =
 * 2/√3 ≈ 1.1547; corpo do tile = 1 unidade de altura, então cada nível de
 * altura empilha 1 unidade e os tiles encaixam sozinhos entre níveis vizinhos.
 *
 * Coordenadas de célula: (col, row) offset; origem no canto. Reusa
 * GameMap.size.width=colunas, height=linhas; heightmap[cell]=nível inteiro;
 * surface[cell]=tipo; collision[cell]=andável/água/parede.
 *
 * TAMANHO DO BLOCO (hexScale — GameplayConfig, editável em /game-editor): um
 * multiplicador uniforme do mundo hex inteiro (posições + tamanho renderizado
 * dos tiles), pra dar impressão de mapa maior sem mexer no charScale (que é
 * relativo ao personagem, independente). `setHexScale` é chamado 1x ao
 * carregar a config (editor e /play) — todo o resto (movimento, câmera,
 * culling, geração procedural) deriva DAQUI, então muda junto automaticamente.
 */

const SQRT3 = Math.sqrt(3);
const BASE_HEX_SIZE = 2 / SQRT3; // 1.1547 (centro→canto), escala 1
const BASE_HEX_W = BASE_HEX_SIZE * SQRT3; // 2.0  — passo horizontal entre colunas
const BASE_HEX_V = BASE_HEX_SIZE * 1.5; // 1.732 — passo vertical entre linhas
const BASE_LEVEL_HEIGHT = 1.0; // altura de 1 nível (corpo do tile), escala 1

let hexScale = 1;

/** limites do tamanho de bloco. O teto acompanha o que o admin oferece
 * (/game-editor → Mundo hex): com um teto MENOR que o do formulário, o mundo
 * era desenhado numa escala e as posições/câmera calculadas noutra — o player
 * ia parar fora do mapa. Piso pequeno evita grid degenerado. */
export const HEX_SCALE_MIN = 0.4;
export const HEX_SCALE_MAX = 12;

/** o valor de hexScale que o runtime realmente usa (config fora da faixa é
 * trazida pra dentro dela). Toda conta de distância tem que passar por aqui. */
export function clampHexScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.max(HEX_SCALE_MIN, Math.min(HEX_SCALE_MAX, scale));
}

/** ajusta o tamanho físico do hex pro resto da sessão (chamado 1x ao carregar
 * GameplayConfig.hexScale — ver play/useGameplayConfig). */
export function setHexScale(scale: number) {
  hexScale = clampHexScale(scale);
}
export function getHexScale(): number {
  return hexScale;
}

export function HEX_SIZE(): number {
  return BASE_HEX_SIZE * hexScale;
}
export function HEX_W(): number {
  return BASE_HEX_W * hexScale;
}
export function HEX_V(): number {
  return BASE_HEX_V * hexScale;
}
export function LEVEL_HEIGHT(): number {
  return BASE_LEVEL_HEIGHT * hexScale;
}

/** centro do tile (col,row) no mundo XZ (linhas ímpares deslocam +meia coluna) */
export function hexToWorld(col: number, row: number): { x: number; z: number } {
  const w = HEX_W(), v = HEX_V();
  const x = w * (col + 0.5 * (row & 1));
  const z = v * row;
  return { x, z };
}

/** célula (col,row) mais próxima do ponto de mundo (arredondamento aproximado,
 * suficiente pra clique do editor e query de altura do movimento) */
export function worldToHex(x: number, z: number): { col: number; row: number } {
  const w = HEX_W(), v = HEX_V();
  const row = Math.round(z / v);
  const col = Math.round(x / w - 0.5 * (row & 1));
  return { col, row };
}

/** topo do tile no mundo (y) pra um dado nível de altura */
export function levelToY(level: number): number {
  return level * LEVEL_HEIGHT();
}

// aux de dev: helpers de hex no console (testes de comportamento)
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __hex?: unknown }).__hex = { hexToWorld, worldToHex, levelToY, getHexScale, setHexScale, cellKey: (c: number, r: number) => `${c},${r}` };
}
