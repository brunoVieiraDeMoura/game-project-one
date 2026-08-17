import * as THREE from "three";
import { createRoot, type Root } from "react-dom/client";
import { createElement, Fragment } from "react";
import { getDomArt, type DomArtRefs, type DomArtScreenPoint } from "./domArtRegistry";
import { injectLegacyVfxArtStyles } from "../../css/legacyVfxArt";
import { projectWorldToScreen } from "./screenProjection";
import { terrainFollowDeltaY } from "../../terrainFollow";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";

/**
 * `renderer:"dom"` — TRANSITÓRIO por definição (invariante leia1.txt):
 * existe só pra preservar a arte CSS atual enquanto os atlases definitivos
 * não existem. Quando uma `VfxDefinition` troca pra `renderer:"sprite"`,
 * ela some do domínio deste renderer sem tocar em nenhum outro código.
 *
 * UM React root (`createRoot`), UM `<Fragment>` com N instâncias — a MESMA
 * técnica já provada em `vfx/mage/fire-wall/FireWallGroup.tsx` (19 `<Html>`
 * independentes → 1), generalizada pra qualquer skill em vez de um caso
 * especial só da Fire Wall. Estrutura (JSX) só re-renderiza quando o
 * CONJUNTO de instâncias muda (nasceu/morreu uma); ANIMAÇÃO (posição na
 * tela, opacidade, classes) é escrita direto no DOM em `onInstanceUpdate`,
 * nunca via `setState`/re-render — mesma garantia de custo que o resto do
 * projeto já exige (`skill-r3f-conventions`: nunca mutação via React no
 * laço de quadro).
 *
 * ## Por que os wrappers são JSX com `ref`, não `document.createElement`
 *
 * Uma primeira versão criava `wrapEl`/`centerEl` na mão (`document.
 * createElement`) e anexava direto no `hostEl` ANTES de qualquer
 * `root.render()`. Bug real, medido: o COMMIT INICIAL de um `createRoot`
 * reivindica o container — nós que já estavam lá, criados por fora do
 * React, somem no primeiro `render()` de verdade (às vezes só no quadro
 * seguinte, por isso o bug só aparecia depois de alguns quadros, nunca no
 * instante do `spawn`). A correção é a mesma técnica JÁ provada em
 * `FireWallGroup.tsx`: o wrapper é JSX de verdade, `ref` captura o nó pra
 * mutação imperativa depois — nunca um nó criado por fora e enxertado.
 *
 * Posicionamento: replica à mão a MESMA fórmula que `drei`'s `<Html
 * distanceFactor={9} transform={false}>` já usava (`Object3D.project`,
 * escala por FOV/distância) — `DISTANCE_FACTOR` é a constante que TODA arte
 * migrada até hoje usava, então fica aqui uma vez só em vez de repetida em
 * cada `art.update()`. A otimização de "câmera parada não retoca o DOM"
 * também vem de `FireWallGroup` (`Html.js:224`, mesma checagem de epsilon).
 * A fórmula em si mora em `screenProjection.ts`, compartilhada com
 * `DomArtUpdateCtx.projectLocalOffset` — arte com sub-elementos em pontos
 * 3D próprios (Fire Ball, Oráculo) usa a MESMA conta, nunca uma segunda.
 */
const EPS_CAM = 1e-5;

interface DomInstanceEntry {
  /** populado pelo `ref` de `renderTree()` — `null` até o React commitar */
  wrapEl: HTMLDivElement | null;
  refs: DomArtRefs;
  bornAt: number;
  positioned: boolean;
  /** capturados na CRIAÇÃO — estáveis pro resto da vida da instância (ver
   * `domArtRegistry.ts: DomArtComponentProps`). */
  cellSize: number;
  targetScale: number;
  payload?: Record<string, unknown>;
}

function DomArtWrapper({
  artKey,
  cellSize,
  targetScale,
  payload,
  portalTarget,
  onRefsReady,
}: {
  artKey: string;
  cellSize: number;
  targetScale: number;
  payload?: Record<string, unknown>;
  portalTarget: HTMLElement;
  onRefsReady: (refs: DomArtRefs) => void;
}) {
  const art = getDomArt(artKey);
  if (!art) return null;
  const refs: DomArtRefs = {};
  onRefsReady(refs);
  return createElement(art.Component, {
    registerRef: (name, el) => {
      refs[name] = el;
    },
    cellSize,
    targetScale,
    payload,
    portalTarget,
  });
}

const WRAP_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  top: "0",
  left: "0",
  pointerEvents: "none",
  opacity: "0",
  willChange: "transform",
};
const CENTER_STYLE: Partial<CSSStyleDeclaration> = { transform: "translate3d(-50%, -50%, 0)" };

export class DomRenderer implements VfxRenderer {
  readonly kind = "dom";

  private readonly hostEl: HTMLDivElement;
  private readonly root: Root;
  private readonly instances = new Map<number, DomInstanceEntry>();
  private readonly artKeys = new Map<number, string>();

  private camera: THREE.Camera | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;

  private readonly camPrev = { pos: new THREE.Vector3(NaN, NaN, NaN), quat: new THREE.Quaternion(), zoom: NaN };
  private renderScheduled = false;
  private disposed = false;

  private readonly hostParent: HTMLElement;

  constructor(hostElement: HTMLElement) {
    injectLegacyVfxArtStyles();
    this.hostEl = document.createElement("div");
    this.hostEl.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;";
    this.hostParent = hostElement;
    hostElement.appendChild(this.hostEl);
    this.root = createRoot(this.hostEl);
  }

  /**
   * Diagnóstico puro (Fase 5, rodada "React/DOM persistent tree isolation")
   * — desconecta/reconecta `hostEl` do `document` SEM desmontar o React
   * root. O `root.render()` continua rodando, `onInstanceUpdate` continua
   * escrevendo `style.transform` em cada nó, nada no Core muda — só a
   * árvore para de participar de layout/paint/composite do navegador
   * enquanto desconectada (`Node.isConnected === false`). Nunca chamado em
   * produção — só pelo benchmark, pra isolar "custo de React/JS mantendo a
   * árvore" de "custo do navegador renderizando uma árvore GRANDE conectada".
   */
  setDocumentAttached(attached: boolean): void {
    if (attached) {
      if (!this.hostEl.isConnected) this.hostParent.appendChild(this.hostEl);
    } else if (this.hostEl.isConnected) {
      this.hostEl.remove();
    }
  }

  /** chamado pelo `VfxRoot` todo quadro, ANTES de `manager.update()` — dá a
   * este renderer a câmera/viewport corrente pra projetar posição em pixel. */
  updateViewport(camera: THREE.Camera, width: number, height: number): void {
    this.camera = camera;
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    const artKey = instance.def.dom?.art;
    if (!artKey || !getDomArt(artKey)) return; // arte não registrada — nunca quebra, só não desenha

    this.instances.set(instance.instanceId, {
      wrapEl: null,
      refs: {},
      bornAt: instance.bornAt,
      positioned: false,
      cellSize: world.cellSize,
      targetScale: instance.targetScale,
      payload: instance.spawnOptions.payload,
    });
    this.artKeys.set(instance.instanceId, artKey);
    this.scheduleRenderTree();
  }

  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void {
    const entry = this.instances.get(instance.instanceId);
    const artKey = this.artKeys.get(instance.instanceId);
    if (!entry || !artKey) return;

    this.reprojectIfNeeded(instance, entry);

    const art = getDomArt(artKey);
    art?.update(entry.refs, {
      elapsedMs,
      bornAt: instance.bornAt,
      pulseCount: instance.pulseCount,
      lastPulseAt: instance.lastPulseAt,
      targetScale: instance.targetScale,
      payload: instance.spawnOptions.payload,
      skillId: instance.spawnOptions.skillId,
      lifetimeMs: instance.expiresAt !== null ? instance.expiresAt - instance.bornAt : null,
      casterOffset: instance.casterOffset,
      projectLocalOffset: (dx, dy, dz) => this.projectLocalOffset(instance, entry, dx, dy, dz),
      terrainFollowDeltaY: (dx, dz) => terrainFollowDeltaY(world.terrain, entry.cellSize, instance.position, dx, dz),
    });
  }

  /** projeta um offset LOCAL (unidades de célula) relativo à âncora desta
   * instância — ver docblock de `DomArtUpdateCtx.projectLocalOffset`. */
  private projectLocalOffset(
    instance: VfxInstanceRuntime,
    entry: DomInstanceEntry,
    dx: number,
    dy: number,
    dz: number,
  ): DomArtScreenPoint | null {
    if (!this.camera) return null;
    const worldPos = {
      x: instance.position.x + dx * entry.cellSize,
      y: instance.position.y + dy * entry.cellSize,
      z: instance.position.z + dz * entry.cellSize,
    };
    return projectWorldToScreen(this.camera, this.viewportWidth, this.viewportHeight, worldPos);
  }

  /**
   * Frustum culling — o renderer que mais ganha com isto: `onInstanceUpdate`
   * some do laço enquanto `active:false` (o manager para de chamar), então
   * o `art.update()` some JUNTO, e é exatamente o RASTER de `blur`/
   * `text-shadow` (o gargalo real medido na Fase 4, não a contagem de nós)
   * que para de acontecer — `display:none` tira o nó do pipeline de
   * paint/raster do navegador inteiro, não só esconde visualmente.
   *
   * `vfx-dom-culled` (achado das Fases J–N, investigação separada): `display:
   * none` no ancestral NÃO pausa `@keyframes ... infinite` de descendentes —
   * o navegador continua agendando/avaliando a animação mesmo assim (medido:
   * ~49ms/quadro extras em 30 instâncias culled só por causa de UMA
   * animação CSS `infinite` num descendente, Oráculo/`.or-glimmer`). A
   * classe (`legacyVfxArt.ts: CORE_CSS`, `.vfx-dom-culled *`) pausa TODA
   * animação CSS na subárvore — genérico, não específico do Oráculo,
   * qualquer arte DOM futura com `@keyframes` ganha a mesma proteção sem
   * precisar saber disso. `animation-play-state: paused` preserva o
   * progresso (não reinicia ao voltar `running`), ao contrário de
   * `animation: none`.
   *
   * Não basta marcar `wrapEl`: arte multi-ponto (Oráculo, Fire Ball,
   * Thunder Storm) porta cada sub-ponto (`createPortal`) direto pro
   * `hostEl` COMPARTILHADO (`portalTarget`, ver `renderTree()`), não como
   * descendente de `wrapEl` — então cada ref registrado
   * (`entry.refs`, os mesmos nós que `art.update()` escreve) também
   * precisa da classe, senão `.vfx-dom-culled *` nunca alcança as
   * animações que vivem fora da árvore de `wrapEl`.
   */
  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    const entry = this.instances.get(instance.instanceId);
    if (!entry?.wrapEl) return;
    entry.wrapEl.style.display = active ? "" : "none";
    entry.wrapEl.classList.toggle("vfx-dom-culled", !active);
    for (const el of Object.values(entry.refs)) el?.classList.toggle("vfx-dom-culled", !active);
    if (active) entry.positioned = false; // força reprojeção completa na volta
  }

  onInstancePulse(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    this.onInstanceUpdate(instance, performance.now() - instance.bornAt, world);
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    if (!this.instances.has(instance.instanceId)) return;
    this.instances.delete(instance.instanceId);
    this.artKeys.delete(instance.instanceId);
    this.scheduleRenderTree(); // React desmonta o `<div>` da instância sozinho, saindo da lista
  }

  /**
   * Agrupa N `onInstanceCreate`/`onInstanceDestroy` síncronos (ex.: Fire
   * Wall plantando ~19 células no MESMO pacote, ou o cenário de estresse do
   * `/vfx-bench` com 50 casts de uma vez) num ÚNICO `root.render()` no
   * microtask seguinte — sem isto, N chamadas síncronas reconciliam uma
   * lista CRESCENTE de 1..N filhos cada vez (O(n²) no total), mesmo com só
   * 1 React root. Medido no benchmark: 19 células sem agrupar já bastava
   * pra disparar `vfxPerformanceSpike`.
   */
  private scheduleRenderTree(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      if (!this.disposed) this.renderTree();
    });
  }

  private renderTree(): void {
    const entries = [...this.instances.entries()];
    this.root.render(
      createElement(
        Fragment,
        null,
        ...entries.map(([id, entry]) => {
          const artKey = this.artKeys.get(id)!;
          return createElement(
            "div",
            {
              key: id,
              ref: (el: HTMLDivElement | null) => {
                entry.wrapEl = el;
              },
              style: WRAP_STYLE,
            },
            createElement(
              "div",
              { style: CENTER_STYLE },
              createElement(DomArtWrapper, {
                artKey,
                cellSize: entry.cellSize,
                targetScale: entry.targetScale,
                payload: entry.payload,
                portalTarget: this.hostEl,
                onRefsReady: (refs: DomArtRefs) => {
                  entry.refs = refs;
                },
              }),
            ),
          );
        }),
      ),
    );
  }

  private reprojectIfNeeded(instance: VfxInstanceRuntime, entry: DomInstanceEntry): void {
    if (!this.camera || !entry.wrapEl) return;
    const cam = this.camPrev;
    const camMoved =
      !this.camera.position.equals(cam.pos) ||
      !this.camera.quaternion.equals(cam.quat) ||
      Math.abs(((this.camera as THREE.PerspectiveCamera).zoom ?? 1) - cam.zoom) > EPS_CAM;

    if (!camMoved && entry.positioned) return;

    const { x, y, scale } = projectWorldToScreen(this.camera, this.viewportWidth, this.viewportHeight, instance.position);
    entry.wrapEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    entry.wrapEl.style.opacity = "1";
    entry.positioned = true;
  }

  flush(): void {
    if (!this.camera) return;
    this.camPrev.pos.copy(this.camera.position);
    this.camPrev.quat.copy(this.camera.quaternion);
    this.camPrev.zoom = (this.camera as THREE.PerspectiveCamera).zoom ?? 1;
  }

  dispose(): void {
    this.disposed = true;
    this.root.unmount();
    this.hostEl.remove();
    this.instances.clear();
    this.artKeys.clear();
  }

  get debugActiveSlots(): number {
    return this.instances.size;
  }
}
