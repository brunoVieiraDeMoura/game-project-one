import type { ComponentType } from "react";

/**
 * Contrato da arte DOM TRANSITÓRIA (`renderer:"dom"`, ver invariante
 * leia1.txt) — o que `DomRenderer` precisa pra desenhar um `vfxId` sem
 * conhecer NADA de nenhuma skill específica.
 *
 * Paralelo direto com o contrato de atlas (`assets/atlasTypes.ts`): ali é
 * `{frames, animations}`, aqui é `{Component, update}`. Quando o atlas de
 * verdade existir, a `VfxDefinition` troca `dom` por `atlas`+`animation` —
 * este registro inteiro (e o próprio `DomRenderer`) some.
 *
 * `Component` monta a estrutura JSX **uma vez só** (nunca recebe estado de
 * animação via props — receber props mutáveis forçaria re-render por
 * quadro, exatamente o custo que este Core existe pra eliminar). Ele só
 * registra os nós que vão ser mutados depois, via `registerRef`.
 *
 * `update` é chamado todo quadro pelo `DomRenderer` — MESMA responsabilidade
 * que o `useFrame` de cada componente antigo tinha, só que como função pura
 * (refs + contexto) em vez de closure de componente.
 */
export interface DomArtRefs {
  [name: string]: HTMLElement | SVGElement | null;
}

/** ponto de tela + escala — mesmo formato de `renderers/screenProjection.ts:
 * ScreenPoint`, redeclarado aqui pra este módulo não depender de three.js. */
export interface DomArtScreenPoint {
  x: number;
  y: number;
  scale: number;
}

export interface DomArtUpdateCtx {
  /** ms desde `bornAt` da instância */
  elapsedMs: number;
  bornAt: number;
  /** quantos `pulse()` esta instância já recebeu — 1 no nascimento, cresce
   * a cada hit coalescido (item 14: Thunder Storm, 1 raio, N pulsos) */
  pulseCount: number;
  lastPulseAt: number;
  targetScale: number;
  payload?: Record<string, unknown>;
  /** skillId de rede que disparou esta instância — só pra efeito colateral
   * de apresentação que precisa dele (SFX por faixa de hits, ex. Thunder
   * Storm: `audio/mage/multiHitCastAudio.aoImpactoMultiHit`). Nunca usado
   * pra decidir RENDERIZAÇÃO — isso é papel do `vfxId`/aegis, não do id cru. */
  skillId?: number;
  /** `null` = vive até `stop()` explícito (área/buff sem prazo fixo);
   * finito = ms totais desta instância (`expiresAt - bornAt`) — pra arte
   * com estágios por FRAÇÃO da vida (Fire Ball: cast cresce até quase o
   * disparo; qualquer skill com "released"/"fade final" por limiar). */
  lifetimeMs: number | null;
  /** offset local (unidades de célula) do CASTER relativo ao ALVO,
   * congelado no spawn — só definido quando a `VfxDefinition` usa
   * `anchor:"caster-to-target"` (projéteis: Fire Ball, Soul Strike). `null`
   * nos outros anchors ou quando o caster não resolveu posição nenhuma. */
  casterOffset: { x: number; y: number; z: number } | null;
  /**
   * Projeta um offset LOCAL (em unidades de CÉLULA, mesma convenção que
   * `casterOffsetX/Y/Z` já usava no código legado) relativo à âncora desta
   * instância pra coordenada de TELA — pra artes com sub-elementos em
   * pontos 3D diferentes (Fire Ball: bola + ecos + estouros; Oráculo:
   * caveiras orbitando). `null` só enquanto a câmera ainda não resolveu
   * (primeiro quadro) — a arte simplesmente pula aquele quadro, nunca
   * quebra. MESMA fórmula que posiciona o wrapper da instância inteira
   * (`DISTANCE_FACTOR`, `renderers/screenProjection.ts`) — nunca uma
   * segunda conta de projeção no projeto.
   */
  projectLocalOffset(dx: number, dy: number, dz: number): DomArtScreenPoint | null;
  /**
   * Correção de altura (unidades de CÉLULA, some direto no `dy` de
   * `projectLocalOffset`) pra um ponto deslocado do centro da instância —
   * mesmo papel que `vfx/terrainFollow.ts: terrainFollowDeltaY` já cumpria
   * pro caminho legado (Oráculo, Fire Ball: partículas/estouros até ~3
   * células do centro não podem herdar a altura do centro em ladeira).
   * `0` em terreno plano — nunca muda o comportamento de quem não precisa.
   */
  terrainFollowDeltaY(dx: number, dz: number): number;
}

export interface DomArtComponentProps {
  registerRef: (name: string, el: HTMLElement | SVGElement | null) => void;
  /** valores estáveis pro tempo de vida da instância (o mapa/tamanho de
   * célula não muda durante um VFX de skill; a escala do alvo também não —
   * mesma suposição que o código antigo já fazia, `targetScale` era
   * `useMemo` sem depender de nada que mude no meio da vida do efeito).
   * Passados só na MONTAGEM — nunca via re-render, isso é o que `update()`
   * é pra fazer. */
  cellSize: number;
  targetScale: number;
  /** payload de gameplay já disponível NO SPAWN (ex.: `areaRadius` do
   * Oráculo) — dados que decidem a ESTRUTURA da arte (quantas partículas,
   * em que raio) e por isso precisam existir na montagem, não só em
   * `update()`. Mesmo objeto de `VfxSpawnOptions.payload`. */
  payload?: Record<string, unknown>;
  /**
   * Container COMPARTILHADO, sem transform nenhum (o mesmo `hostEl` que
   * `DomRenderer` já mantém pro jogo inteiro) — pra arte com MÚLTIPLOS
   * pontos 3D (Fire Ball: bola+ecos+estouros; Oráculo: caveiras+partículas)
   * portar seus sub-elementos aqui via `createPortal`, posicionados com
   * `left/top` calculados por `projectLocalOffset`. O wrapper NORMAL
   * (`ref`/`WRAP_STYLE`) já tem `transform: translate3d(...)` — herdar dele
   * quebraria `position:fixed`/cálculo manual de tela; portar direto aqui
   * evita a conta de "desfazer" o transform do ancestral.
   */
  portalTarget: HTMLElement;
}

export interface DomArtSpec {
  Component: ComponentType<DomArtComponentProps>;
  update(refs: DomArtRefs, ctx: DomArtUpdateCtx): void;
}

const registry = new Map<string, DomArtSpec>();

export function registerDomArt(key: string, spec: DomArtSpec): void {
  registry.set(key, spec);
}

export function getDomArt(key: string): DomArtSpec | undefined {
  return registry.get(key);
}

/** só para teste: esvazia o registro. */
export function resetDomArtRegistry(): void {
  registry.clear();
}
