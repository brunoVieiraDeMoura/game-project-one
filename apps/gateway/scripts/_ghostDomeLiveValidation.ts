/**
 * Validação AO VIVO do caminho ghost-dome-block contra o rAthena real,
 * pós-patch v2 (rathena-patches/0001: MISS também consome carga).
 *
 * v1 deste script usava 2 jogadores (atacante+alvo) — descoberto ao vivo
 * que prt_fild08 não é mapa PVP, então PC-vs-PC nunca gera entity-action
 * nenhum (servidor recusa calado). v2 usa MONSTRO real já cadastrado no
 * projeto (npc-idle/mobs/prt_fild08.txt: Orc Warrior/Orc Lady, mob-vs-PC
 * nunca tem essa restrição) como atacante — PROT provoca com 1 attack()
 * e o mob revida sozinho a cada tick de ASPD dele.
 *
 * Uso: npx tsx scripts/_ghostDomeLiveValidation.ts   (de dentro de apps/gateway)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { RoSession } from "../src/ro/session.js";

const MG_SAFETYWALL = 12;
const MAP = "prt_fild08";
// dentro da area de spawn real (195,200 raio 5,5 — npc-idle/mobs/prt_fild08.txt)
const PROT_CELL = { x: 197, y: 202 };
const WALL2_CELL = { x: 210, y: 210 }; // fora da area de spawn, sem mob por perto

let sqlCounter = 0;
function sql(query: string): string {
  sqlCounter += 1;
  const winPath = `${process.env.TEMP ?? "C:\\Windows\\Temp"}\\_gd_sql_${sqlCounter}.sql`;
  writeFileSync(winPath, query, "utf8");
  const wslPath = "/mnt/c" + winPath.slice(2).replace(/\\/g, "/");
  return execFileSync("wsl", ["-d", "Ubuntu", "-u", "root", "bash", "-c", `mariadb gameproject -N < ${wslPath}`], {
    encoding: "utf8",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BlockEvent {
  sourceGid: number;
  targetGid: number;
  remainingHits: number;
  t: number;
}
interface ActionEvent {
  gid: number;
  targetGid: number;
  damage: number;
  count: number;
  action: number;
  t: number;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString().slice(-7);
  const t0 = Date.now();

  const session = new RoSession({
    host: config.roHost,
    loginPort: config.loginPort,
    packetver: config.packetver,
    debug: true,
  });

  const chars0 = new Promise<void>((resolve) => session.once("chars", () => resolve()));
  await session.authenticate(`gdlp${suffix}_M`, "gp123456pass");
  await chars0;

  const relisted = new Promise<void>((resolve) => session.once("chars", () => resolve()));
  session.createChar({ slot: 0, name: `GdProt${suffix}`, hair: 1, hairColor: 1 });
  await relisted;

  const protGid = session.chars[0]?.gid;
  if (!protGid) throw new Error("createChar não retornou gid");

  sql(`INSERT INTO skill (char_id, id, lv, flag) VALUES (${protGid}, ${MG_SAFETYWALL}, 10, 0)
       ON DUPLICATE KEY UPDATE lv=10;`);
  // SEM base_level/job_level/stats — Novice (class=0) tem MaxBaseLevel real
  // baixo no job_db; forçar 50 via SQL direto (sem passar pelo job change)
  // e o suspeito nº1 do achado ao vivo desta rodada: zero entity-spawn E
  // zero ack de movimento em QUALQUER célula, inclusive uma confirmada
  // caminhável em diagnóstico anterior — sugere o servidor parando de
  // processar ações desse char depois do load, não problema de terreno.
  sql(`UPDATE \`char\` SET
         sp=9999, max_sp=9999, hp=9999, max_hp=9999,
         last_map='${MAP}', last_x=${PROT_CELL.x}, last_y=${PROT_CELL.y}
       WHERE char_id=${protGid};`);

  const entered = new Promise<{ mapName: string; x: number; y: number }>((resolve) =>
    session.once("map-enter", resolve),
  );
  session.selectChar(0);
  const world = await entered;
  // ACHADO desta rodada: `session.chars[0].gid` (char-select) e `session.gid`
  // (in-map, ZC_AID) sao numeros DIFERENTES — o primeiro e char_id (usado só
  // pra SQL), o segundo é o id real usado em TODO pacote in-map
  // (entity-action, ghost-dome-block). Confundir os dois fez o script achar
  // "0 ataques" quando na verdade o mob já estava acertando PROT o tempo
  // todo — o filtro comparava com o gid errado.
  const protMapGid = session.gid;
  console.log(
    `[PROT] no mapa: charGid=${protGid} mapGid=${protMapGid} map=${world.mapName} cell=(${world.x},${world.y})`,
  );
  // ACHADO desta rodada: sem isto, o map-server nunca "liga" o personagem —
  // ele aceita a conexao e manda o burst inicial de stats, mas ignora TODA
  // acao depois (walk, attack, skill), silenciosamente. Explica tambem o
  // "bug de GM command" investigado bem mais cedo nesta sessao (provavelmente
  // o mesmo artefato, nao um bug de servidor de verdade).
  session.notifyReady();

  const blockEvents: BlockEvent[] = [];
  const actionEvents: ActionEvent[] = [];
  const groundEvents: { gid: number; x: number; y: number; skillId: number; t: number }[] = [];
  const groundGoneEvents: { gid: number; t: number }[] = [];
  const mobsSeen = new Map<number, { job: number; x: number; y: number }>();

  let totalSpawns = 0;
  session.on("entity-spawn", (p: { gid: number; kind: string; job: number; x: number; y: number }) => {
    totalSpawns += 1;
    console.log(`[entity-spawn] gid=${p.gid} kind=${p.kind} job=${p.job} cell=(${p.x},${p.y})`);
    if (p.kind === "mob") {
      mobsSeen.set(p.gid, { job: p.job, x: p.x, y: p.y });
    }
  });
  session.on("ghost-dome-block", (p) => {
    blockEvents.push({ ...p, t: Date.now() - t0 });
    console.log(
      `[EVENT ghost-dome-block] source=${p.sourceGid} target=${p.targetGid} remainingHits=${p.remainingHits} t=${Date.now() - t0}ms`,
    );
  });
  session.on("entity-action", (p: ActionEvent) => {
    actionEvents.push({ ...p, t: Date.now() - t0 });
    console.log(
      `[EVENT entity-action] ${p.gid}->${p.targetGid} damage=${p.damage} count=${p.count} action=${p.action} t=${Date.now() - t0}ms`,
    );
  });
  session.on("skill-ground", (p) => {
    groundEvents.push({ ...p, t: Date.now() - t0 });
    console.log(`[EVENT skill-ground] gid=${p.gid} skillId=${p.skillId} cell=(${p.x},${p.y}) t=${Date.now() - t0}ms`);
  });
  session.on("skill-ground-gone", (p) => {
    groundGoneEvents.push({ ...p, t: Date.now() - t0 });
    console.log(`[EVENT skill-ground-gone] gid=${p.gid} t=${Date.now() - t0}ms`);
  });

  // dá tempo do servidor anunciar os mobs proximos (NOTIFY_STANDENTRY em AOI,
  // area_size=60 — mundo inteiro, nao só o raio do spawn de teste)
  await sleep(5000);
  console.log(`total entity-spawn (qualquer kind): ${totalSpawns}`);
  console.log(`mobs vistos ate agora: ${mobsSeen.size} — ${JSON.stringify([...mobsSeen.entries()])}`);

  // area_size=60 (rathena-conf/battle_conf.txt) faz o mundo inteiro anunciar
  // mob — precisa filtrar pelos IDs REAIS do spawn de teste (Orc Warrior
  // 1023 / Orc Lady 1273, npc-idle/mobs/prt_fild08.txt) e pegar o mais
  // PERTO de PROT, senão pega um mob a 50+ células de distância.
  const ORC_JOBS = new Set([1023, 1273]);
  let mobGid = 0;
  let bestDist = Infinity;
  for (const [gid, m] of mobsSeen) {
    if (!ORC_JOBS.has(m.job)) continue;
    const dist = Math.abs(m.x - world.x) + Math.abs(m.y - world.y);
    if (dist < bestDist) {
      bestDist = dist;
      mobGid = gid;
    }
  }
  console.log(`mob escolhido: gid=${mobGid} distancia=${bestDist}`);
  if (!mobGid) {
    console.log("NENHUM MOB VISTO — abortando (spawn pode estar fora de alcance).");
    session.close();
    return;
  }

  // --- FASE 1: cast Safety Wall nivel 10 na propria celula ---
  console.log("\n=== FASE 1: casting MG_SAFETYWALL nivel 10 ===");
  const wallSeen = new Promise<void>((resolve) => session.once("skill-ground", () => resolve()));
  session.useSkillOnGround(MG_SAFETYWALL, 10, { x: world.x, y: world.y });
  await Promise.race([wallSeen, sleep(8000)]);
  if (groundEvents.length === 0) {
    console.log("AVISO: skill-ground nao chegou em 8s — wall pode nao ter sido criada.");
  }

  // --- FASE 2: provoca o mob — deixa o AUTO-CHASE do proprio servidor
  // (unit.cpp: unit_attack_timer_sub, persegue a posicao AO VIVO do mob a
  // cada tick) resolver a aproximacao. Pre-andar pra uma posicao antiga do
  // mob (tentativa anterior) so afastava PROT de onde o mob realmente
  // estava, porque mob de campo anda sozinho — pior que deixar quieto.
  console.log(`\n=== FASE 2: provocando mob gid=${mobGid} (distancia inicial ${bestDist}), esperando 11 blocks ===`);
  session.attack(mobGid, true);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && blockEvents.length < 11) {
    await sleep(500);
  }
  console.log(`blocks apos fase 2: ${blockEvents.length}`);

  // --- FASE 3: continua levando pancada (hit 12+, wall deveria estar morta) ---
  console.log("\n=== FASE 3: continuando apos a 11a carga (hit 12+) ===");
  const blocksAt11 = blockEvents.length;
  await sleep(8000);
  console.log(`blocks apos fase 3 (deveria seguir ${blocksAt11}): ${blockEvents.length}`);

  // --- FASE 4: segunda wall em celula SEM mob por perto; PROT nao se move pra la ---
  console.log("\n=== FASE 4: segunda wall em celula distante (controle 'fora da wall') ===");
  const wall2Seen = new Promise<void>((resolve) => {
    const handler = (p: { x: number; y: number }) => {
      if (p.x === WALL2_CELL.x && p.y === WALL2_CELL.y) {
        session.off("skill-ground", handler);
        resolve();
      }
    };
    session.on("skill-ground", handler);
  });
  session.useSkillOnGround(MG_SAFETYWALL, 10, WALL2_CELL);
  await Promise.race([wall2Seen, sleep(8000)]);
  const blocksBeforeOutside = blockEvents.length;
  await sleep(6000);
  console.log(`blocks durante fase 4 (fora da wall2, deveria ficar ${blocksBeforeOutside}): ${blockEvents.length}`);

  // --- resumo ---
  console.log("\n\n================ RESUMO ================");
  console.log(`total ghost-dome-block: ${blockEvents.length}`);
  console.log("sequencia remainingHits:", blockEvents.map((e) => e.remainingHits).join(","));
  const attacksVsProt = actionEvents.filter((a) => a.gid === mobGid && a.targetGid === protMapGid);
  console.log(`total ataques do mob contra PROT: ${attacksVsProt.length}`);
  console.log(
    "sequencia hit/miss dos ataques do mob:",
    attacksVsProt.map((a) => (a.damage > 0 ? `HIT(${a.damage})` : "MISS")).join(","),
  );
  console.log(`skill-ground (wall criada): ${groundEvents.length}`);
  console.log(`skill-ground-gone (wall destruida): ${groundGoneEvents.length}`);
  console.log(JSON.stringify({ blockEvents, attacksVsProt, groundEvents, groundGoneEvents }, null, 2));

  session.close();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
