/**
 * Prepara o glTF do Espadachim novo (rig Mixamo, `assets-new/characters-test/`)
 * para `public/assets/characters/Knight_Mixamo.gltf` — teste isolado da
 * linhagem Espadachim (ver `apps/game/src/entities/classModels.ts`).
 *
 * O acervo fonte tem 3 defeitos que impedem carregar direto:
 *
 *  1. `model/knight.gltf` referencia `buffers[0].uri = "tpose.bin"`, mas o
 *     arquivo no disco é `knight.bin` (mesmo tamanho — foi renomeado).
 *  2. O material não liga `knight_texture.png` — malha tem `TEXCOORD_0` mas
 *     `images`/`textures` estão vazios, então renderiza cinza.
 *  3. O clip de ataque vive em OUTRO arquivo
 *     (`knight_animations/knight_1h-melee-attack.gltf`, com o próprio
 *     `.bin`) — precisa ser mesclado dentro do modelo pra `useGLTF` carregar
 *     tudo numa chamada só.
 *
 * Os 8 clips embutidos em `knight.gltf` (mais o 9º do arquivo de ataque) têm
 * nomes inúteis (`mixamo.com`, `mixamo.com.001` … ) — são exports
 * incrementais do MESMO .blend, e cada arquivo em `geral-animation/`
 * acumula os clips do anterior mais UM novo (o último). A duração desse
 * último clip identifica o papel: casando duração (não índice, que muda se
 * o usuário reexportar em outra ordem) contra a duração do último clip de
 * cada `geral-animation/*.gltf`, decifra o nome de verdade.
 *
 * Root motion: `walk` e `run` têm o `mixamorig:Hips` deslocando no eixo de
 * avanço (localX/localY, medido lendo o buffer) — a posição da entidade é
 * do servidor (`docs/claude-context/04-netcode-prediction-reconciliation.md`),
 * então isso faz o modelo deslizar e voltar a cada loop. Zerado aqui,
 * preservando localZ (o balanço vertical do quadril). `idle`/`hit`/`death`/
 * `attack` não são tocados — o deslocamento deles é intencional.
 *
 * Re-executável: se o usuário reexportar qualquer arquivo fonte, roda de
 * novo e refaz a saída. O original em `assets-new/` nunca é escrito.
 *
 * Uso: pnpm --filter @ragnarok/game chars:knight-mixamo
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SRC = resolve(REPO_ROOT, "assets-new/characters-test");
const OUT_DIR = resolve(HERE, "../public/assets/characters");

const KNIGHT_GLTF = `${SRC}/model/knight.gltf`;
const KNIGHT_BIN = `${SRC}/model/knight.bin`;
const KNIGHT_TEXTURE = `${SRC}/model/knight_texture.png`;
const ATTACK_GLTF = `${SRC}/knight_animations/knight_1h-melee-attack.gltf`;

const OUT_GLTF = `${OUT_DIR}/Knight_Mixamo.gltf`;
const OUT_BIN = `${OUT_DIR}/Knight_Mixamo.bin`;
const OUT_TEXTURE = `${OUT_DIR}/Knight_Mixamo.png`;

/** mapeia o NOME do arquivo de referência (não a ordem) pro papel do `ClipSet` */
const ROLE_BY_REF_FILE = {
  "idle.gltf": "idle",
  "walking.gltf": "walk",
  "running.gltf": "run",
  "death.gltf": "death",
  "react-hit.gltf": "hit",
};
const REF_FILES = Object.keys(ROLE_BY_REF_FILE).map((f) => `${SRC}/geral-animation/${f}`);

const FLOAT = 5126;
const DUR_TOLERANCE = 0.02; // ~meio frame a 30fps
const JUNK_DURATION = 0.1; // clips <= isto são as sobras de 2 frames (0,07s)
const ROOT_MOTION_ROLES = new Set(["walk", "run"]);
const HIPS_NODE_NAME = "mixamorig:Hips";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function accessorByteLength(accessor) {
  const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  if (accessor.componentType !== FLOAT) {
    throw new Error(`accessor com componentType ${accessor.componentType} não suportado (só FLOAT)`);
  }
  return accessor.count * numComp * 4;
}

/** duração do clip = maior `max[0]` entre os accessors de tempo (input) dos samplers */
function clipDuration(anim, json) {
  let max = 0;
  for (const sampler of anim.samplers) {
    const acc = json.accessors[sampler.input];
    if (acc.max && acc.max[0] > max) max = acc.max[0];
  }
  return max;
}

function nodeIndexByName(json, name) {
  const i = json.nodes.findIndex((n) => n.name === name);
  if (i < 0) throw new Error(`node "${name}" não encontrado`);
  return i;
}

// ---------------------------------------------------------------------------
// 1. dicionário duração → papel, a partir dos arquivos de referência
// ---------------------------------------------------------------------------
const relatorio = [];
const durationToRole = new Map(); // duração arredondada (2 casas) -> papel
for (const path of REF_FILES) {
  const json = loadJson(path);
  const last = json.animations.at(-1);
  const dur = clipDuration(last, json);
  const role = ROLE_BY_REF_FILE[path.split("/").pop()];
  durationToRole.set(Number(dur.toFixed(2)), role);
}

function matchRole(dur) {
  for (const [key, role] of durationToRole) {
    if (Math.abs(dur - key) < DUR_TOLERANCE) return role;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 2. knight.gltf: renomear os 5 clips conhecidos, descartar o lixo
// ---------------------------------------------------------------------------
const knightJson = loadJson(KNIGHT_GLTF);
const knightBin = readFileSync(KNIGHT_BIN);

const kept = [];
for (const anim of knightJson.animations) {
  const dur = clipDuration(anim, knightJson);
  const role = matchRole(dur);
  if (role) {
    anim.name = role;
    kept.push(anim);
    relatorio.push(`  ${role.padEnd(6)} <- ${dur.toFixed(2)}s (embutido em knight.gltf)`);
  } else if (dur <= JUNK_DURATION) {
    relatorio.push(`  (descartado) ${dur.toFixed(2)}s — sobra de export incremental`);
  } else {
    throw new Error(
      `clip de ${dur.toFixed(2)}s em knight.gltf não bate com papel nenhum conhecido — ` +
        `reexport mudou algo? papéis conhecidos: ${[...durationToRole.keys()].join(", ")}`,
    );
  }
}
const rolesFound = kept.map((a) => a.name).sort();
const rolesExpected = ["death", "hit", "idle", "run", "walk"];
if (rolesFound.join(",") !== rolesExpected.join(",")) {
  throw new Error(`papéis incompletos em knight.gltf: achei [${rolesFound}], esperava [${rolesExpected}]`);
}
knightJson.animations = kept;

// ---------------------------------------------------------------------------
// 3. zerar root motion de walk/run (in-place nos bytes do knight.bin)
// ---------------------------------------------------------------------------
const knightBinMut = Buffer.from(knightBin); // cópia — nunca escreve no arquivo original
const hipsIndex = nodeIndexByName(knightJson, HIPS_NODE_NAME);

for (const anim of kept) {
  if (!ROOT_MOTION_ROLES.has(anim.name)) continue;
  const channel = anim.channels.find((c) => c.target.node === hipsIndex && c.target.path === "translation");
  if (!channel) throw new Error(`clip "${anim.name}" sem canal de translation no Hips`);
  const accessor = knightJson.accessors[anim.samplers[channel.sampler].output];
  const bufferView = knightJson.bufferViews[accessor.bufferView];
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (bufferView.byteStride) throw new Error(`bufferView de "${anim.name}" é interleaved — não suportado`);
  const frame0X = knightBinMut.readFloatLE(base);
  const frame0Y = knightBinMut.readFloatLE(base + 4);
  for (let k = 0; k < accessor.count; k++) {
    const off = base + k * 12; // VEC3 float = 12 bytes
    knightBinMut.writeFloatLE(frame0X, off); // X (lateral) travado
    knightBinMut.writeFloatLE(frame0Y, off + 4); // Y (avanço) travado
    // Z (balanço vertical do quadril) fica como veio
  }
  relatorio.push(`  root motion zerado: "${anim.name}" (${accessor.count} frames, Hips X/Y travados no frame 0)`);
}

// ---------------------------------------------------------------------------
// 4. mesclar o clip de ataque do arquivo separado
// ---------------------------------------------------------------------------
const attackJson = loadJson(ATTACK_GLTF);
const attackBinPath = `${SRC}/knight_animations/${attackJson.buffers[0].uri}`;
const attackBin = readFileSync(attackBinPath);
if (attackBin.length !== attackJson.buffers[0].byteLength) {
  throw new Error(`attack.bin (${attackBin.length} bytes) não bate com buffers[0].byteLength do gltf`);
}

const attackAnim = attackJson.animations.at(-1); // padrão do export incremental: o último é o novo
const attackDur = clipDuration(attackAnim, attackJson);
if (matchRole(attackDur)) {
  throw new Error(`clip de ataque (${attackDur.toFixed(2)}s) bate com um papel já conhecido — verificar manualmente`);
}

const bufferViewOffsetShift = knightBinMut.length; // attack.bin é anexado depois do knight.bin
const importedAccessor = new Map(); // índice em attackJson.accessors -> índice em knightJson.accessors

function importAttackAccessor(oldIndex) {
  const cached = importedAccessor.get(oldIndex);
  if (cached !== undefined) return cached;
  const srcAcc = attackJson.accessors[oldIndex];
  const srcBv = attackJson.bufferViews[srcAcc.bufferView];
  if (srcBv.byteStride) throw new Error("bufferView de ataque interleaved — não suportado");
  const newBv = {
    buffer: 0,
    byteOffset: (srcBv.byteOffset ?? 0) + bufferViewOffsetShift,
    byteLength: srcBv.byteLength,
  };
  const newBvIndex = knightJson.bufferViews.push(newBv) - 1;
  const newAcc = { ...srcAcc, bufferView: newBvIndex };
  const newAccIndex = knightJson.accessors.push(newAcc) - 1;
  importedAccessor.set(oldIndex, newAccIndex);
  return newAccIndex;
}

const attackNodeNames = attackJson.nodes.map((n) => n.name);
const newChannels = [];
const newSamplers = [];
const importedSampler = new Map(); // índice em attackAnim.samplers -> índice em newSamplers

for (const ch of attackAnim.channels) {
  const targetName = attackNodeNames[ch.target.node];
  const newTargetNode = nodeIndexByName(knightJson, targetName); // por NOME — a ordem dos nós difere entre os dois arquivos
  let newSamplerIndex = importedSampler.get(ch.sampler);
  if (newSamplerIndex === undefined) {
    const srcSampler = attackAnim.samplers[ch.sampler];
    const newSampler = {
      input: importAttackAccessor(srcSampler.input),
      output: importAttackAccessor(srcSampler.output),
      interpolation: srcSampler.interpolation,
    };
    newSamplerIndex = newSamplers.push(newSampler) - 1;
    importedSampler.set(ch.sampler, newSamplerIndex);
  }
  newChannels.push({ sampler: newSamplerIndex, target: { node: newTargetNode, path: ch.target.path } });
}

knightJson.animations.push({ name: "attack", channels: newChannels, samplers: newSamplers });
relatorio.push(
  `  attack <- ${attackDur.toFixed(2)}s (mesclado de knight_1h-melee-attack.gltf, ${newChannels.length} canais, root motion preservado)`,
);

const outputBin = Buffer.concat([knightBinMut, attackBin]);

// ---------------------------------------------------------------------------
// 5. buffer uri + textura
// ---------------------------------------------------------------------------
knightJson.buffers[0] = { byteLength: outputBin.length, uri: "Knight_Mixamo.bin" };

knightJson.images = [{ uri: "Knight_Mixamo.png" }];
knightJson.samplers = [{}]; // sampler de textura default (linear, repeat) — glTF já assume isso sem o campo
knightJson.textures = [{ sampler: 0, source: 0 }];
knightJson.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };

// ---------------------------------------------------------------------------
// 6. auto-checagem antes de escrever (a mesma que a verificação manual pede)
// ---------------------------------------------------------------------------
const finalRoles = knightJson.animations.map((a) => a.name).sort();
const expectedFinal = ["attack", "death", "hit", "idle", "run", "walk"];
if (finalRoles.join(",") !== expectedFinal.join(",")) {
  throw new Error(`saída incompleta: achei [${finalRoles}], esperava [${expectedFinal}]`);
}
for (const anim of knightJson.animations) {
  for (const ch of anim.channels) {
    if (!knightJson.nodes[ch.target.node]) throw new Error(`clip "${anim.name}" aponta pra node inexistente`);
  }
  for (const s of anim.samplers) {
    for (const accIdx of [s.input, s.output]) {
      const acc = knightJson.accessors[accIdx];
      const bv = knightJson.bufferViews[acc.bufferView];
      const end = (bv.byteOffset ?? 0) + bv.byteLength;
      if (end > outputBin.length) {
        throw new Error(`clip "${anim.name}" referencia bytes além do .bin gerado (${end} > ${outputBin.length})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. escrever
// ---------------------------------------------------------------------------
writeFileSync(OUT_GLTF, JSON.stringify(knightJson));
writeFileSync(OUT_BIN, outputBin);
copyFileSync(KNIGHT_TEXTURE, OUT_TEXTURE);

console.log(`Knight_Mixamo pronto em ${OUT_DIR}`);
console.log(relatorio.join("\n"));
console.log(
  `\n.gltf ${(JSON.stringify(knightJson).length / 1024).toFixed(0)} KB | .bin ${(outputBin.length / 1024).toFixed(0)} KB | .png ${(readFileSync(KNIGHT_TEXTURE).length / 1024).toFixed(0)} KB`,
);
console.log(`clips finais: ${finalRoles.join(", ")}`);
