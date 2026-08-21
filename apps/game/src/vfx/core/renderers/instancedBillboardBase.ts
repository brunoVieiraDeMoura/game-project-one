import * as THREE from "three";
import { loadedAtlas } from "../assets/atlasLoader";
import { ensureAtlasLoaded } from "../assets/manifest";
import type { VfxDefinition, VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { VfxRenderer } from "./rendererTypes";

/**
 * Base compartilhada por `SpriteRenderer`/`ParticleRenderer` — UM
 * `InstancedMesh` (item 3 do pedido: "batching quando possível"), billboard
 * calculado no vertex shader a partir da `viewMatrix` (MESMA técnica já
 * provada em `vfx/AmbientParticles.tsx`, não uma segunda implementação).
 *
 * Slot morto (instância destruída) não é COMPACTADO — é escrito com
 * `scale=0` e devolvido ao pool (`pool.ts`) pra reuso. `InstancedMesh`
 * precisa de um `count` contíguo desde o índice 0; escrever "invisível" em
 * vez de remover é o jeito padrão de reciclar slot sem re-empacotar o
 * buffer inteiro a cada morte.
 *
 * Sem atlas registrado (estado atual do projeto — invariante leia1.txt:
 * nenhum asset definitivo existe ainda), a textura cai num placeholder
 * PROCEDURAL (disco radial gerado em runtime, nunca um arquivo no disco) —
 * suficiente pra provar o pipeline (posição/escala/UV/draw) sem inventar
 * arte nenhuma. Documentado explicitamente como "não é a arte final".
 */

const QUAD = new THREE.PlaneGeometry(1, 1);

const VERTEX = `
uniform float uTime;
attribute vec3 aOffset;
attribute float aScale;
attribute float aStretch;
attribute vec4 aFrameUv; // u0, v0, u1, v1
attribute vec3 aColor;
attribute float aOpacity;
attribute float aRotation;
// empacotado num vec3 SÓ (não 3 attributes separados) — WebGL conta 1 slot
// de vertex attribute por VARIAVEL, não por componente (vec3/vec4 custam o
// mesmo 1 slot que um float); MAX_VERTEX_ATTRIBS de alguns drivers (achado
// real: SwiftShader/software renderer deste projeto, ver docs/claude-context/09)
// fica perto do limite garantido do WebGL2 (16) — 3 floats soltos aqui
// estourava ("Too many attributes"), 1 vec3 não.
// x=seed, y=noiseAmt, z=flameShape (>0.5 = ligado), w=breatheAmt (respiração
// ANCORADA NA BASE — pedido "começa em 0% na base, termina em 100% no
// topo", ver docblock abaixo).
attribute vec4 aFlameParams;
// POR-INSTÂNCIA, não uniform — achado real (leia1.txt, "Eletrocutar deixa
// toda skill de sprite com o raio dele"): uHasAtlas como uniform de
// MATERIAL (antes desta correção) valia pro InstancedMesh inteiro — uma
// instância de Eletrocutar carregando o atlas ligava o branch de textura
// pra TODA OUTRA instância do mesmo material (Fire Ball, Fire Wall, Cold
// Bolt...) até o renderer ser recriado (reconnect). Cada instância decide
// por si (SpriteRenderer.writeFromInstance, só true quando atlas+frame
// resolveram de verdade), nunca uma decisão global.
attribute float aHasAtlas;
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
varying vec4 vFlameParams;
varying float vHasAtlas;
void main() {
  vec2 frameUv = mix(aFrameUv.xy, aFrameUv.zw, uv);
  vUv = frameUv;
  vColor = aColor;
  vOpacity = aOpacity;
  vFlameParams = aFlameParams;
  vHasAtlas = aHasAtlas;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  // esticado no eixo VERTICAL DA TELA (up), depois de rotacionar — nunca antes
  // (esticar antes da rotação enviesaria o losango pra uma direção diagonal em
  // vez de alongar reto na tela, ver docblock de dropStretch.ts).
  rotated.y *= aStretch;
  // respiração "pra frente/pra trás" (pedido: crescer/encolher, NÃO o lean
  // lateral de aRotation) ANCORADA na base do quad: uv.y vai de 0 (borda
  // de baixo) a 1 (borda de cima) ANTES do stretch escalar — na borda de
  // baixo o termo é 0 (posição intocada, "0% na base"), na borda de cima
  // vira aFlameParams.w inteiro somado ao topo já esticado ("100% no
  // topo", mesma amplitude que a antiga escala uniforme dava lá, só que sem
  // mover a base junto). Ausente/0 = comportamento de sempre.
  rotated.y += aFlameParams.w * 0.5 * aStretch * clamp(uv.y, 0.0, 1.0);
  vec3 worldOffset = (right * rotated.x + up * rotated.y) * aScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(aOffset + worldOffset, 1.0);
}`;

/**
 * `aFlameParams` (x=seed, y=noiseAmt, z=flameShape, w=breatheAmt — Fire
 * Wall, pedido "muito circular, tem que parecer mais com chama" + "noise
 * pra balançar/crepitar" + gradiente vertical vermelho escuro→laranja→
 * amarelo + respiração ancorada na base) — modo OPT-IN por instância no
 * placeholder procedural (sem atlas), MESMO espírito de `payload.flipX`/
 * `payload.depthTest`: `z<=0.5` = comportamento de sempre (disco radial
 * branco tingido por `vColor`), nenhuma outra skill muda. Empacotado num
 * ÚNICO `vec4` (não 4 `attribute float` separados) — achado real ao testar
 * ao vivo: attributes soltos estouravam `MAX_VERTEX_ATTRIBS` do driver
 * ("Too many attributes (aFlameShape)", SwiftShader/software renderer
 * deste projeto, ver docs/claude-context/09) porque `InstancedMesh` já
 * consome 4 slots com `instanceMatrix` + 2 com `position`/`uv` da
 * geometria — WebGL conta 1 slot por VARIÁVEL de attribute, não por
 * componente, então 1 `vec4` custa o mesmo 1 slot que 1 `float` custava
 * sozinho (e o mesmo que o `vec3` de antes, `w` novo veio "de graça").
 *
 * `w` (breatheAmt) resolve o pedido "essa animação balançando pra frente e
 * pra trás... começa em 0% na base e termina em 100% no topo": ANTES, a
 * respiração de escala (`idleFlicker.ts: scaleMul`) multiplicava o `aScale`
 * inteiro, simétrico a partir do CENTRO do quad — a base descia junto
 * quando a chama "crescia". Agora `SpriteRenderer.ts` NÃO dobra
 * `idle.scaleMul` em `aScale` pra camadas `flameShape` — passa
 * `scaleMul-1` aqui, e o `VERTEX` soma isso à posição já esticada
 * PONDERADO por `uv.y` (0 na borda de baixo do quad, 1 na de cima): base
 * fica intocada, topo recebe a amplitude cheia (mesma magnitude que a
 * escala uniforme dava antes no topo, só que sem arrastar a base).
 *
 * `z>0.5` troca o disco por uma forma de CHAMA de verdade, calculada em
 * `vUv.y` (0=base do quad, 1=ponta — mesmo eixo que `aStretch` já alonga):
 * raio mais largo embaixo, afinando pra cima (`radiusAtY`), gradiente de
 * cor fixo embutido no shader (vermelho escuro→laranja→amarelo, do
 * pedido), e ruído 2D barato (`vnoise`, hash+interpolação bilinear, sem
 * textura) perturbando tanto a borda quanto o raio — `x` (seed) desfasa o
 * ruído por instância (senão todas as células "crepitariam" em sincronia
 * perfeita, mesmo problema que idleFlicker.ts já resolve pra escala/
 * opacidade) e `uTime` (já incrementado em `flush()` pra qualquer skill que
 * use `ring`, aqui reaproveitado) anima o ruído no tempo — sem custo extra:
 * mesmo `uniform` que já existia, só passou a ser lido no fragment também.
 */
const FRAGMENT = `
uniform float uTime;
// uMap continua um sampler SÓ (compartilhado) — hoje só existe 1 skill
// com atlas de verdade (Eletrocutar), então "qual textura" nunca conflita.
// Se uma SEGUNDA skill ganhar atlas próprio, isto precisa virar textura
// por-instância (array/atlas-de-atlas) — fora de escopo aqui, documentado
// pra não ser esquecido.
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
varying float vOpacity;
varying vec4 vFlameParams; // x=seed, y=noiseAmt, z=flameShape (>0.5 = ligado), w=breatheAmt
varying float vHasAtlas;

float vhash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  if (vHasAtlas > 0.5) {
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vOpacity);
  } else if (vFlameParams.z > 0.5) {
    float vNoiseAmt = vFlameParams.y;
    float t = clamp(vUv.y, 0.0, 1.0);
    float seedOff = vFlameParams.x * 41.0;
    // 3ª rodada ("força mais ruído, mas mantém a forma reconhecível") — 4
    // octaves agora (era 3): bojo grande (baixa freq, dá o formato geral) +
    // aperto médio + rasgado fino (alta freq, textura de borda irregular
    // "esfarrapada") — cada um pesa MENOS que o anterior (soma sempre
    // controlada, nunca destrói a silhueta base). A curva corpo→ponta virou
    // um mix CONTÍNUO (era um t<0.4?: com quina visível na derivada,
    // uma pista geométrica a menos) em vez de troca abrupta.
    float n1 = vnoise(vec2(t * 1.4 + seedOff, uTime * 0.3 + seedOff)) - 0.5;
    float n2 = vnoise(vec2(t * 3.1 + seedOff * 1.7, uTime * 0.7 + seedOff)) - 0.5;
    float n3 = vnoise(vec2(vUv.x * 9.0 + seedOff, t * 11.0 - uTime * 2.2 + seedOff)) - 0.5;
    float n4 = vnoise(vec2(vUv.x * 18.0 + seedOff * 2.3, t * 22.0 - uTime * 3.4 + seedOff)) - 0.5;
    float bulge = (n1 * 0.55 + n2 * 0.3 + n3 * 0.15) * 0.32 * vNoiseAmt;
    float ragged = n4 * 0.09 * vNoiseAmt;
    float sway = n1 * 0.1 * vNoiseAmt;
    float bodyRadius = mix(0.4, 0.3, smoothstep(0.0, 0.4, t));
    float tipRadius = mix(0.3, 0.04, pow(clamp((t - 0.4) / 0.6, 0.0, 1.0), 1.5));
    float baseRadius = mix(bodyRadius, tipRadius, smoothstep(0.3, 0.5, t));
    float radiusAtY = max(0.012, baseRadius + bulge + ragged);
    float dx = abs(vUv.x - 0.5 + sway);
    float edgeSoftness = 0.09 + 0.05 * vNoiseAmt;
    float shapeAlpha = smoothstep(radiusAtY, radiusAtY - edgeSoftness, dx);
    float verticalFade = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.88, t);
    float alpha = shapeAlpha * verticalFade;

    // gradiente do pedido: mais clara (quase branca) na BASE, vermelho
    // escuro na base, laranja subindo, amarelo na ponta — SEM parada branca
    // (pedido: "tira a parte branca de baixo").
    vec3 cDarkRed = vec3(0.55, 0.09, 0.04);
    vec3 cOrange = vec3(1.0, 0.46, 0.09);
    vec3 cYellow = vec3(1.0, 0.82, 0.36);
    vec3 col;
    if (t < 0.6) {
      col = mix(cDarkRed, cOrange, t / 0.6);
    } else {
      col = mix(cOrange, cYellow, min(1.0, (t - 0.6) / 0.4));
    }
    gl_FragColor = vec4(col * vColor, alpha * vOpacity);
  } else {
    float a = smoothstep(0.5, 0.0, distance(vUv, vec2(0.5)));
    gl_FragColor = vec4(vColor, a * vOpacity);
  }
  if (gl_FragColor.a <= 0.001) discard;
}`;

let placeholderTexture: THREE.Texture | null = null;
/** disco radial branco, gerado em canvas — placeholder de VALIDAÇÃO, nunca
 * usado por uma `VfxDefinition` real (as 18 famílias migradas até a Fase 5
 * usam `renderer:"dom"`, que nem passa por aqui). */
function getPlaceholderTexture(): THREE.Texture {
  if (placeholderTexture) return placeholderTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  placeholderTexture = new THREE.CanvasTexture(canvas);
  return placeholderTexture;
}

interface Slot {
  index: number;
}

export abstract class InstancedBillboardBase implements VfxRenderer {
  abstract readonly kind: string;

  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private capacity = 0;
  private highWater = 0;
  private readonly freeSlots: number[] = [];
  private readonly group: THREE.Group;

  private offset!: Float32Array;
  private scaleAttr!: Float32Array;
  private stretchAttr!: Float32Array;
  private uvAttr!: Float32Array;
  private colorAttr!: Float32Array;
  private opacityAttr!: Float32Array;
  private rotationAttr!: Float32Array;
  /** x=seed, y=noiseAmt, z=flameShape, w=breatheAmt — empacotado num vec4 só, ver docblock do `FRAGMENT` acima. */
  private flameParamsAttr!: Float32Array;
  /** POR-INSTÂNCIA (não uniform de material) — ver docblock do `VERTEX` acima. */
  private hasAtlasAttr!: Float32Array;

  /**
   * Achado da auditoria Fase 4 (relatório, seção C): `flush()` marcava os 6
   * atributos como `needsUpdate=true` TODO quadro, incondicionalmente — o
   * driver reenviava o buffer INTEIRO (tamanho = capacidade, não instâncias
   * ativas) mesmo sem nada ter mudado. `dirtyMin`/`dirtyMax` rastreiam a
   * FAIXA de índices tocados desde o último flush (`writeSlot` é o único
   * escritor); flush usa `addUpdateRange` pra reenviar só essa faixa, e pula
   * o upload inteiro quando nada mudou (idle steady-state, o caso comum de
   * uma instância só animando opacidade via CSS não existe aqui — mas
   * partículas paradas entre pulsos de vida, sim).
   */
  private dirtyMin = Infinity;
  private dirtyMax = -Infinity;

  constructor(group: THREE.Group, initialCapacity = 128) {
    this.group = group;
    this.ensureCapacity(initialCapacity);
  }

  private markDirty(index: number): void {
    if (index < this.dirtyMin) this.dirtyMin = index;
    if (index > this.dirtyMax) this.dirtyMax = index;
  }

  private ensureCapacity(min: number): void {
    if (min <= this.capacity) return;
    const newCapacity = Math.max(min, this.capacity === 0 ? 128 : this.capacity * 2);

    const geometry = QUAD.clone();
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 }, uMap: { value: getPlaceholderTexture() } },
    });

    const offset = new Float32Array(newCapacity * 3);
    const scaleAttr = new Float32Array(newCapacity);
    const stretchAttr = new Float32Array(newCapacity).fill(1);
    const uvAttr = new Float32Array(newCapacity * 4);
    const colorAttr = new Float32Array(newCapacity * 3).fill(1);
    const opacityAttr = new Float32Array(newCapacity);
    const rotationAttr = new Float32Array(newCapacity);
    const flameParamsAttr = new Float32Array(newCapacity * 4);
    const hasAtlasAttr = new Float32Array(newCapacity);

    // default do frame UV é "atlas inteiro" (u1=v1=1) — preenchido ANTES de
    // copiar o estado preservado, pra nunca sobrescrever um UV real por
    // engano (evita depender de "== 0" pra distinguir default de valor real).
    for (let i = 0; i < newCapacity; i++) {
      uvAttr[i * 4 + 2] = 1;
      uvAttr[i * 4 + 3] = 1;
    }

    // preserva o que já existia (crescimento nunca perde instância viva)
    if (this.offset) offset.set(this.offset);
    if (this.scaleAttr) scaleAttr.set(this.scaleAttr);
    if (this.stretchAttr) stretchAttr.set(this.stretchAttr);
    if (this.uvAttr) uvAttr.set(this.uvAttr);
    if (this.colorAttr) colorAttr.set(this.colorAttr);
    if (this.opacityAttr) opacityAttr.set(this.opacityAttr);
    if (this.rotationAttr) rotationAttr.set(this.rotationAttr);
    if (this.flameParamsAttr) flameParamsAttr.set(this.flameParamsAttr);
    if (this.hasAtlasAttr) hasAtlasAttr.set(this.hasAtlasAttr);

    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
    geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scaleAttr, 1));
    geometry.setAttribute("aStretch", new THREE.InstancedBufferAttribute(stretchAttr, 1));
    geometry.setAttribute("aFrameUv", new THREE.InstancedBufferAttribute(uvAttr, 4));
    geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(colorAttr, 3));
    geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(opacityAttr, 1));
    geometry.setAttribute("aRotation", new THREE.InstancedBufferAttribute(rotationAttr, 1));
    geometry.setAttribute("aFlameParams", new THREE.InstancedBufferAttribute(flameParamsAttr, 4));
    geometry.setAttribute("aHasAtlas", new THREE.InstancedBufferAttribute(hasAtlasAttr, 1));

    const mesh = new THREE.InstancedMesh(geometry, material, newCapacity);
    mesh.frustumCulled = false;
    mesh.count = 0;

    // achado real da auditoria Fase 4 (não ideal, corrigido aqui): a
    // geometria/material ANTIGOS eram desanexados do grupo mas nunca
    // recebiam `.dispose()` — vazava 1 geometria + 1 material por
    // crescimento de capacidade (raro, ~log2(N) vezes por sessão, mas real).
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
    }
    this.group.add(mesh);

    this.mesh = mesh;
    this.material = material;
    this.offset = offset;
    this.scaleAttr = scaleAttr;
    this.stretchAttr = stretchAttr;
    this.uvAttr = uvAttr;
    this.colorAttr = colorAttr;
    this.opacityAttr = opacityAttr;
    this.rotationAttr = rotationAttr;
    this.flameParamsAttr = flameParamsAttr;
    this.hasAtlasAttr = hasAtlasAttr;
    this.capacity = newCapacity;
    // índices em [highWater, newCapacity) ficam DISPONÍVEIS mas fora da
    // free-list de propósito (lista "preguiçosa" — `acquireSlot` incrementa
    // `highWater` direto quando a free-list está vazia; não há necessidade
    // de pré-popular nada aqui, só garantir que o espaço existe).
  }

  protected acquireSlot(): Slot {
    const reused = this.freeSlots.pop();
    if (reused !== undefined) return { index: reused };
    this.ensureCapacity(this.highWater + 1);
    const index = this.highWater++;
    return { index };
  }

  protected releaseSlot(slot: Slot): void {
    this.writeSlot(slot.index, { position: [0, -9999, 0], scale: 0, opacity: 0, rotation: 0, color: [1, 1, 1] });
    this.freeSlots.push(slot.index);
  }

  /** frustum culling (`rendererTypes.ts: VfxRenderer.setActive`) — escala
   * 0 é a MESMA técnica de `releaseSlot` (vértice degenerado, ~0 custo de
   * fragmento), mas sem devolver o slot ao pool: a instância ainda existe,
   * só está fora da câmera. Não mexe em posição/UV/cor — o próximo
   * `onInstanceUpdate` (quando a instância voltar a ficar visível) já
   * reescreve tudo via `writeSlot`. */
  protected writeInactiveSlot(index: number): void {
    this.scaleAttr[index] = 0;
    this.opacityAttr[index] = 0;
    this.markDirty(index);
  }

  protected writeSlot(
    index: number,
    data: {
      position: readonly [number, number, number];
      scale: number;
      opacity: number;
      rotation?: number;
      /** multiplicador não-uniforme aplicado ao eixo VERTICAL DA TELA
       * (`aStretch`, ver `VERTEX` acima) — ausente/`1` = quad normal, mesmo
       * comportamento de sempre. Só quem passa isso explicitamente (Fire
       * Lance, via `dropStretch.ts`) muda de forma. */
      stretch?: number;
      color?: readonly [number, number, number];
      uv?: readonly [number, number, number, number];
      /** fase determinística por instância (`idleFlicker.ts`/`aFlameShape`
       * já usam o mesmo `instanceId`-derivado) — ausente/`0` só importa pra
       * quem lê `aSeed` no shader (hoje só o modo `flameShape`). */
      seed?: number;
      /** intensidade do ruído do modo `flameShape` (`aFlameParams.y`) — `0`/
       * ausente = sem ruído, mesmo com `flameShape:true` (forma de chama
       * "lisa"). */
      noiseAmt?: number;
      /** liga o modo "forma de chama" do placeholder procedural
       * (`aFlameParams.z`, ver docblock do `FRAGMENT` acima) — `false`/
       * ausente = disco radial de sempre, nenhuma outra skill muda. */
      flameShape?: boolean;
      /** respiração ancorada na base (`aFlameParams.w`) — `0`/ausente =
       * quad não respira (só some se quem chama nunca passar isto). Só faz
       * sentido junto com `flameShape:true`; ver docblock do `VERTEX`. */
      breatheAmt?: number;
      /** ESTA instância deve amostrar `uMap` em vez do placeholder/forma
       * procedural — `false`/ausente = comportamento de sempre (a imensa
       * maioria). Só `SpriteRenderer.writeFromInstance` passa `true`, e só
       * quando `def.atlas` + o frame do quadro atual realmente resolveram
       * (ver docblock do `VERTEX` acima pro bug real que isto corrige). */
      hasAtlas?: boolean;
    },
  ): void {
    this.offset[index * 3] = data.position[0];
    this.offset[index * 3 + 1] = data.position[1];
    this.offset[index * 3 + 2] = data.position[2];
    this.scaleAttr[index] = data.scale;
    this.stretchAttr[index] = data.stretch ?? 1;
    this.opacityAttr[index] = data.opacity;
    this.rotationAttr[index] = data.rotation ?? 0;
    this.flameParamsAttr[index * 4] = data.seed ?? 0;
    this.flameParamsAttr[index * 4 + 1] = data.noiseAmt ?? 0;
    this.flameParamsAttr[index * 4 + 2] = data.flameShape ? 1 : 0;
    this.flameParamsAttr[index * 4 + 3] = data.breatheAmt ?? 0;
    this.hasAtlasAttr[index] = data.hasAtlas ? 1 : 0;
    const color = data.color ?? [1, 1, 1];
    this.colorAttr[index * 3] = color[0];
    this.colorAttr[index * 3 + 1] = color[1];
    this.colorAttr[index * 3 + 2] = color[2];
    const uv = data.uv ?? [0, 0, 1, 1];
    this.uvAttr[index * 4] = uv[0];
    this.uvAttr[index * 4 + 1] = uv[1];
    this.uvAttr[index * 4 + 2] = uv[2];
    this.uvAttr[index * 4 + 3] = uv[3];
    this.markDirty(index);
  }

  /** tenta anexar o atlas real da definição — sem-op enquanto não existe
   * (`loadedAtlas` devolve `undefined`, o placeholder continua valendo).
   * Só troca `uMap` (sampler compartilhado, ok enquanto só existir 1 skill
   * com atlas — ver docblock do `FRAGMENT`) — NUNCA liga o branch de
   * textura pra ninguém: isso é decisão por-instância agora
   * (`aHasAtlas`/`writeSlot`, escrita por quem realmente resolveu
   * atlas+frame em `SpriteRenderer.writeFromInstance`). */
  protected trySyncAtlas(def: VfxDefinition): void {
    if (!def.atlas || !this.material) return;
    void ensureAtlasLoaded(def.atlas).catch(() => {
      /* atlas ainda não registrado/disponível — placeholder segue valendo */
    });
    const atlas = loadedAtlas(def.atlas);
    if (atlas) {
      this.material.uniforms.uMap!.value = atlas.texture;
    }
  }

  flush(dt: number, _world: VfxWorldContext): void {
    void _world;
    if (!this.mesh || !this.material) return;
    this.material.uniforms.uTime!.value += dt;
    this.mesh.count = this.highWater;

    // nada escrito desde o último flush (nenhum spawn/update/release tocou
    // um slot) — pula o upload inteiro. Era o comportamento incondicional
    // encontrado na auditoria; aqui o caso comum (steady-state entre pulsos
    // de vida) custa 0 upload em vez de 6 buffers do tamanho da capacidade.
    if (this.dirtyMin > this.dirtyMax) return;

    const start = this.dirtyMin;
    const count = this.dirtyMax - this.dirtyMin + 1;
    const attrs: [string, number][] = [
      ["aOffset", 3],
      ["aScale", 1],
      ["aStretch", 1],
      ["aFrameUv", 4],
      ["aColor", 3],
      ["aOpacity", 1],
      ["aRotation", 1],
      ["aFlameParams", 4],
      ["aHasAtlas", 1],
    ];
    for (const [name, componentsPerVertex] of attrs) {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(start * componentsPerVertex, count * componentsPerVertex);
      attr.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
  }

  abstract onInstanceCreate(instance: VfxInstanceRuntime, world: VfxWorldContext): void;
  abstract onInstanceUpdate(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): void;
  abstract onInstanceDestroy(instance: VfxInstanceRuntime): void;

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
      this.mesh = null;
    }
  }

  /** só pra teste: quantos slots estão em uso agora. */
  get debugActiveSlots(): number {
    return this.highWater - this.freeSlots.length;
  }
}
