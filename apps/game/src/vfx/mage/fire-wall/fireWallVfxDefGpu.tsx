import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Fire Wall em GPU (Directive B, "migração agressiva performance-first",
 * prioridade #3 depois de Oracle/Cold Bolt) — PROTÓTIPO. `fireWallVfxDef.
 * tsx` (a versão DOM real, produção) é INTOCADA — `fireWallRenderMode.ts`
 * troca a receita pela MESMA técnica já provada em Fire Ball/Oracle
 * (`defineVfx` registra OU SUBSTITUI o MESMO id "fire_wall").
 *
 * Fire Wall planta N CÉLULAS simultâneas por cast (`unit.layout:-1`, até
 * ~19-21 numa parede real) — cada célula é uma instância PRÓPRIA
 * (`anchor:"cell"`, sem `coalesce`, igual à versão DOM). O custo antigo
 * era por CÉLULA: 40 brasas (`@keyframes ... infinite`) + `.fw-glow`/
 * `.fw-smoke` com `filter:blur()` + `.fw-column__core` com `clip-path`+
 * `drop-shadow`+skew — replicado N vezes por parede, N paredes por combo.
 *
 * Composição GPU (identidade essencial preservada — forma: coluna de
 * fogo; cor: laranja/vermelho/amarelo; movimento: chamas + brasas subindo;
 * sensação de poder: brilho da base + núcleo brilhante):
 *   - 1× `sprite` — corpo da chama (substitui `.fw-column__core`+licks,
 *     billboard aditivo, sem `clip-path`/skew — forma vem do gradiente
 *     radial do shader, não de geometria recortada);
 *   - 1× `sprite` — núcleo brilhante por cima (substitui o brilho central
 *     do core, mais claro/menor, aditivo);
 *   - 1× `particle` — brasas subindo (substitui até 40 `.fw-ember` por
 *     célula por uma contagem FIXA baixa, nunca escalando com número de
 *     células/players — mesma regra já aplicada em Cold Bolt).
 *
 * `ring` (brilho no chão, `.fw-glow`) foi TESTADO e DESCARTADO: checagem
 * visual (Fase AW) mostrou o disco (raio grande o bastante pra "brilho de
 * chão") desenhado por CIMA da chama, cobrindo-a inteira — `ring`/`sprite`
 * são `InstancedMesh`/`Mesh` SEPARADOS, ambos `depthTest:false`, e o Three
 * ordena transparentes por distância aproximada da CÂMERA, não por camada
 * lógica da definição; um raio grande o bastante pra ler como "poça de
 * brilho" fica maior que a chama e vence esse sorteio. Simplificação
 * aceita (item explícito do pedido: reduzir camadas se precisar) — o
 * brilho de base já vem do próprio degradê aditivo dos dois sprites.
 *
 * SEM camada `dom`: Fire Wall não tem números de dano próprios (é
 * dano-ao-longo-do-tempo por tick, mostrado pelo `net/damageFeed`
 * genérico de sempre, fora do VFX) — ao contrário de Cold Bolt/Thunder
 * Storm, não existe exceção a documentar aqui.
 */

const FLAME_COLOR = "#ff8a2e";
const CORE_COLOR = "#fff3c4";
const EMBER_COLOR = "#ffb347";
const EMBER_COUNT = 12;

function buildFireWallGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "sprite",
      scale: { base: 1.7 },
      offset: [0, 0.65, 0],
      params: { color: FLAME_COLOR, opacity: 0.8 },
    },
    {
      renderer: "sprite",
      scale: { base: 0.7 },
      offset: [0, 0.45, 0],
      params: { color: CORE_COLOR, opacity: 0.95 },
    },
    {
      renderer: "particle",
      scale: { base: 0.14 },
      params: { particleCount: EMBER_COUNT, radius: 0.35, color: EMBER_COLOR },
    },
  ];
}

export const FIRE_WALL_GPU_DEF: VfxDefinition = {
  id: "fire_wall",
  renderer: "sprite",
  anchor: "cell",
  layers: buildFireWallGpuLayers(),
};
