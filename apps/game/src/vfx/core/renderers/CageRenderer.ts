import * as THREE from "three";
import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";
import { computeOrbitOffset } from "./orbitOffset";

/**
 * `renderer:"cage"` — gaiola de cristal 3D ao redor de uma célula (Cúpula
 * Sagrada, 2026-08-19-x: "personagem parecendo que está dentro, sem as
 * camadas de trás passarem por cima dele", ref. `cupula-sagrada.jpg`).
 *
 * NOVO renderer (6º) porque nenhum dos 5 existentes desenha uma forma 3D
 * real ao redor de uma entidade: `sprite`/`particle`/`trail`/`beam` são
 * billboards (sempre de frente pra câmera, não formam aresta reta nenhuma
 * de um ângulo lateral) e `ring` é um disco/contorno PLANO no chão
 * (`moldarMalhaTerreno`, molda ao relevo — nunca sobe em 3D). Uma "gaiola"
 * (octaedro/diamante de arestas, como a referência) precisa de geometria
 * 3D de verdade.
 *
 * ## Por que o personagem NUNCA fica coberto (o bug que gerou o pedido)
 *
 * `RingRenderer` desliga `depthTest` de propósito ("VFX de skill fica por
 * cima", correto pra um DECAL de chão — precisa atravessar grama/relevo).
 * Uma gaiola que ENVOLVE um personagem de pé é o caso OPOSTO: o lado de
 * TRÁS da gaiola (do ponto de vista da câmera) tem que ficar ATRÁS do
 * personagem de verdade, não por cima. Este renderer nunca desliga
 * `depthTest` em nenhum material — respeita o z-buffer normal, então:
 *   - as ARESTAS (`LineSegments`, `edges` abaixo) são linhas finas — mesmo
 *     com depth test normal, cruzam o personagem só como um traço fino
 *     (exatamente a leitura da imagem de referência), nunca cobrem ele;
 *   - o VIDRO translúcido (`fill` abaixo) usa `side: THREE.BackSide` — só a
 *     face INTERNA do lado LONGE da câmera é desenhada; o lado PERTO da
 *     câmera (entre ela e o personagem) nunca existe como triângulo
 *     nenhum, então não tem o que ocultar.
 *
 * ## Pool (mesmo padrão de `RingRenderer.ts`)
 *
 * Gaiolas são RARAS (poucas simultâneas, nunca centenas por quadro como
 * partícula de hit) — 1 grupo de `THREE.Object3D` por instância, pool
 * reaproveitado, geometria COMPARTILHADA a nível de módulo (nunca recriada
 * por instância — só a matriz de transformação/material mudam).
 */
const EDGE_COLOR_DEFAULT = "#ffffff";
const FILL_COLOR_DEFAULT = "#dce8ff";
const BAND_COLOR_DEFAULT = "#8fe0d0";
/** octaedro unitário (raio 1) — cross-section quadrado no meio, ponta em
 * cima/embaixo: EXATAMENTE a silhueta de diamante da referência. Raio/
 * altura reais vêm da ESCALA do mesh por instância (`scale.set`), nunca de
 * geometria nova — troca de tamanho não recria buffer nenhum. */
const UNIT_OCTAHEDRON = new THREE.OctahedronGeometry(1, 0);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_OCTAHEDRON);
/** faixa de brilho na base — TORUS fino, não um plano (`RingGeometry`
 * testado e descartado 2026-08-19-x: um plano infinitamente fino visto de
 * ângulo raso vira "traços quebrados" — grazing angle deixa a maioria dos
 * segmentos com área de tela quase zero. Torus tem espessura real na
 * direção vertical, lê como um anel limpo de QUALQUER ângulo de câmera —
 * mesma técnica usada em anéis de brilho de outros jogos por este motivo
 * exato). MESMA técnica de escala (raio vem do `scale`, geometria unitária
 * fixa, nunca recriada). */
const UNIT_BAND = new THREE.TorusGeometry(1, 0.035, 8, 48);
/** face achatada de frente pra câmera (não aresta) — pedido estético da
 * referência ("losango", não "X" visto de frente). */
const ROTATION_Y = Math.PI / 4;
/** posição da faixa de brilho, medida do EQUADOR (0) até a ponta de baixo
 * (1) — 0.65 grudou bem na referência (nem no meio largo, nem na ponta). */
const BAND_T = 0.65;
/** graus/segundo padrão da rotação horizontal — 360°/24s, "devagar" do
 * pedido (rápido o bastante pra perceber, devagar o bastante pra não
 * distrair de uma barreira/buff parado). */
const DEFAULT_ROTATE_SPEED_DEG_PER_SEC = 15;

interface CageEntry {
  group: THREE.Group;
  edges: THREE.LineSegments;
  edgeMaterial: THREE.LineBasicMaterial;
  fill: THREE.Mesh;
  fillMaterial: THREE.MeshBasicMaterial;
  band: THREE.Mesh;
  bandMaterial: THREE.MeshBasicMaterial;
}

function buildEntry(): CageEntry {
  const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR_DEFAULT, transparent: true, opacity: 0.9, depthWrite: false });
  const edges = new THREE.LineSegments(UNIT_EDGES, edgeMaterial);

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: FILL_COLOR_DEFAULT,
    transparent: true,
    opacity: 0.07,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const fill = new THREE.Mesh(UNIT_OCTAHEDRON, fillMaterial);

  const bandMaterial = new THREE.MeshBasicMaterial({
    color: BAND_COLOR_DEFAULT,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const band = new THREE.Mesh(UNIT_BAND, bandMaterial);
  band.rotation.x = -Math.PI / 2; // deitado no chão

  const group = new THREE.Group();
  group.add(edges, fill, band);
  group.rotation.y = ROTATION_Y;
  group.visible = false;
  return { group, edges, edgeMaterial, fill, fillMaterial, band, bandMaterial };
}

export class CageRenderer implements VfxRenderer {
  readonly kind = "cage";
  private readonly groupParent: THREE.Group;
  private readonly entries = new Map<number, CageEntry>();
  private readonly pool: CageEntry[] = [];

  constructor(group: THREE.Group) {
    this.groupParent = group;
  }

  private acquire(): CageEntry {
    const reused = this.pool.pop();
    if (reused) return reused;
    const entry = buildEntry();
    this.groupParent.add(entry.group);
    return entry;
  }

  /** ver docblock de `VfxRenderer.warm` — mesmo raciocínio do `RingRenderer`. */
  warm(): void {
    if (this.pool.length > 0 || this.entries.size > 0) return;
    const entry = buildEntry();
    this.groupParent.add(entry.group);
    this.pool.push(entry);
  }

  onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void {
    const payload = instance.spawnOptions.payload;
    const radius = Number(payload?.radius ?? 1.1) * world.cellSize;
    const height = Number(payload?.height ?? 2.4);
    const edgeColor = String(payload?.edgeColor ?? EDGE_COLOR_DEFAULT);
    const fillColor = String(payload?.fillColor ?? FILL_COLOR_DEFAULT);
    const fillOpacity = Number(payload?.fillOpacity ?? 0.07);
    const bandColor = String(payload?.bandColor ?? BAND_COLOR_DEFAULT);
    const bandOpacity = Number(payload?.bandOpacity ?? 0.55);

    const entry = this.acquire();
    entry.edgeMaterial.color.set(edgeColor);
    entry.fillMaterial.color.set(fillColor);
    entry.fillMaterial.opacity = fillOpacity;
    entry.bandMaterial.color.set(bandColor);
    entry.bandMaterial.opacity = bandOpacity;

    entry.edges.scale.set(radius, height, radius);
    entry.fill.scale.set(radius, height, radius);
    // faixa GRUDADA na superfície do diamante, não um anel solto flutuando
    // no chão — precisa do RAIO da seção transversal do octaedro NA ALTURA
    // onde ela nasce, não o raio do equador (isso fazia um "disco voador"
    // enorme separado da forma, achado visual 2026-08-19-x). Seção
    // transversal cresce LINEARMENTE de 0 (ponta de baixo) até `radius`
    // (equador) — `BAND_T` é a fração dessa distância, medida A PARTIR do
    // equador (0=equador, 1=ponta): raio = `radius*(1-BAND_T)`, altura
    // local = `-height*BAND_T`.
    const bandRadius = radius * (1 - BAND_T);
    // `band` já está rotacionado -90° em X (plano XY local → XZ de mundo,
    // deitado) — a escala acontece ANTES da rotação (ordem TRS padrão do
    // Three), então os DOIS eixos do plano do anel são X/Y locais (não
    // X/Z): `(bandRadius, bandRadius, 1)`, nunca `(radius, 1, radius)`
    // (bug real, esticava só 1 eixo — corrigido 2026-08-19-x, junto com o
    // raio errado).
    entry.band.scale.set(bandRadius, bandRadius, 1);
    entry.band.position.y = -height * BAND_T;
    entry.group.visible = true;
    this.entries.set(instance.instanceId, entry);
    this.applyTransform(entry, instance, height, 0, world);
  }

  /**
   * Posição/rotação recalculadas TODO quadro (Cúpula Sagrada, 2026-08-19-ze:
   * "3 prismas voando e girando ao redor da célula principal, na altura do
   * peito") — antes só a rotação animava (`ROTATION_Y` + giro), a posição
   * era fixa no nascimento. `payload.orbitRadius` (novo aqui, MESMO
   * `orbitOffset.ts` que Oracle/os fantasmas antigos já usavam) faz o grupo
   * inteiro circular ao redor da célula ANTES de aplicar `height` — sem
   * `orbitRadius`, `computeOrbitOffset` devolve zero e o comportamento é
   * IDÊNTICO ao de antes (gaiola única, parada no centro), nenhuma skill
   * existente muda.
   *
   * `payload.rotateSpeedDegPerSec` (default 15 — 24s por volta, "devagar")
   * soma em cima do `ROTATION_Y` estético fixo (face achatada de frente pra
   * câmera no nascimento) — continua girando no próprio eixo INDEPENDENTE
   * da órbita ao redor da célula.
   */
  onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void {
    const entry = this.entries.get(instance.instanceId);
    if (!entry) return;
    const height = Number(instance.spawnOptions.payload?.height ?? 2.4);
    this.applyTransform(entry, instance, height, elapsedMs, world);
  }

  /**
   * `orbitRadius` presente = órbita ao redor da célula: o grupo CENTRALIZA
   * na altura da órbita (`payload.orbitHeight`, ex. peito), nunca ancora a
   * ponta de baixo no chão — é o mesmo campo que já existia
   * (`height`/`+height`), só reinterpretado quando a gaiola está voando em
   * vez de envolver o personagem de pé. Ausente = comportamento de sempre
   * (ponta de baixo encosta no chão, `+height`).
   */
  private applyTransform(entry: CageEntry, instance: VfxInstanceRuntime, height: number, elapsedMs: number, world: VfxWorldContext): void {
    const payload = instance.spawnOptions.payload;
    const orbit = computeOrbitOffset(instance, elapsedMs, world);
    const orbiting = typeof payload?.orbitRadius === "number";
    const yBase = orbiting ? instance.position.y : instance.position.y + height;
    entry.group.position.set(instance.position.x + orbit.x, yBase + orbit.y, instance.position.z + orbit.z);

    const speedDegPerSec = Number(payload?.rotateSpeedDegPerSec ?? DEFAULT_ROTATE_SPEED_DEG_PER_SEC);
    entry.group.rotation.y = ROTATION_Y + THREE.MathUtils.degToRad(speedDegPerSec) * (elapsedMs / 1000);
  }

  setActive(instance: VfxInstanceRuntime, active: boolean): void {
    const entry = this.entries.get(instance.instanceId);
    if (entry) entry.group.visible = active;
  }

  onInstanceDestroy(instance: VfxInstanceRuntime): void {
    const entry = this.entries.get(instance.instanceId);
    if (!entry) return;
    entry.group.visible = false;
    this.entries.delete(instance.instanceId);
    this.pool.push(entry);
  }

  flush(): void {
    // nada por quadro hoje — reservado pro mesmo padrão de `RingRenderer`
    // (`uTime`/pulso) se uma versão futura precisar de brilho pulsante.
  }

  dispose(): void {
    for (const entry of [...this.entries.values(), ...this.pool]) {
      this.groupParent.remove(entry.group);
      entry.edgeMaterial.dispose();
      entry.fillMaterial.dispose();
      entry.bandMaterial.dispose();
    }
    this.entries.clear();
    this.pool.length = 0;
  }

  get debugActiveSlots(): number {
    return this.entries.size;
  }
}
