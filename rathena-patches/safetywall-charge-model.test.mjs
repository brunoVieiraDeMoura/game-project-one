// Modelo ISOLADO da regra de consumo de carga da Safety Wall
// (rathena-patches/0001-ghost-dome-safetywall-block-notify.patch).
//
// NÃO executa o battle.cpp real — o rAthena não tem framework de teste C++
// (nenhum gtest/catch2 no projeto, `find rathena -iname "*test*"` só acha
// scripts NPC de conteúdo, nada de unit test). Isto é um espelho fiel, em
// TS/JS, da MESMA lógica que está em `battle_calc_weapon_attack()`
// (rathena/src/map/battle.cpp, logo após `initialize_weapon_data()` — v3 do
// patch; v2 morava em `battle_weapon_attack()`, mas lá o `flag` é sempre 0
// hardcoded no único call site, então nunca disparava pra NINGUÉM, jogador
// ou mob — achado testando ataque de mob ao vivo). O ALGORITMO em si não
// mudou entre v2 e v3, só o ponto do pipeline onde ele roda — objetivo
// deste arquivo continua sendo provar que o algoritmo está certo
// isoladamente, não substituir prova em runtime real.
//
// Regra espelhada, linha a linha:
//   if (skill_id == 0 && tsc && (wd.flag & (BF_SHORT|BF_MAGIC)) == BF_SHORT) {
//     if (sce && sce->val2 == MG_SAFETYWALL) {
//       group = skill_id2group(sce->val3);
//       if (group) {
//         safetyWallBlock = true;
//         if (--group->val2 <= 0) { notify(0); delete group; }
//         else { notify(group->val2); }
//       }
//     }
//   }
//
// Rodar: node rathena-patches/safetywall-charge-model.test.mjs

import assert from "node:assert/strict";

const BF_SHORT = 1;
const BF_MAGIC = 4;

function safetyWallHook(group, flag) {
  // espelha exatamente: `(flag & (BF_SHORT|BF_MAGIC)) == BF_SHORT`
  if ((flag & (BF_SHORT | BF_MAGIC)) !== BF_SHORT) {
    return { safetyWallBlock: false, notified: null };
  }
  if (!group) {
    return { safetyWallBlock: false, notified: null };
  }
  group.val2 -= 1; // --group->val2
  if (group.val2 <= 0) {
    group.destroyed = true;
    return { safetyWallBlock: true, notified: 0 };
  }
  return { safetyWallBlock: true, notified: group.val2 };
}

// --- teste 1: 11 ataques, HIT/MISS alternados (resultado NÃO entra na
// função — é justamente isso que prova "outcome irrelevante") ---
{
  const outcomesForDisplayOnly = [
    "MISS", "MISS", "HIT", "MISS", "HIT",
    "MISS", "MISS", "HIT", "MISS", "MISS", "MISS",
  ];
  const group = { val2: 11 }; // nivel 10 => skill_lv+1 = 11
  const log = [];
  for (let i = 0; i < 11; i++) {
    const { safetyWallBlock, notified } = safetyWallHook(group, BF_SHORT);
    log.push({ attack: i + 1, outcome: outcomesForDisplayOnly[i], consumed: safetyWallBlock, remainingHits: notified });
  }
  console.log("=== 11 ataques HIT/MISS misturados ===");
  console.table(log);
  assert.equal(log.length, 11);
  assert.deepEqual(log.map((l) => l.remainingHits), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.ok(log.every((l) => l.consumed === true), "todo ataque, HIT ou MISS, consome");
  assert.equal(group.val2, 0);
  assert.equal(group.destroyed, true);
  console.log("PASS: 11 ataques (mix HIT/MISS) -> remainingHits 10..0, sempre consumido, wall destruida no 11o.\n");
}

// --- teste 2: 11 ataques, TODOS miss (o teste mais importante do pedido) ---
{
  const group = { val2: 11 };
  const remainingHits = [];
  for (let i = 0; i < 11; i++) {
    const { notified } = safetyWallHook(group, BF_SHORT);
    remainingHits.push(notified);
  }
  console.log("=== 11 MISS consecutivos ===");
  console.log("remainingHits:", remainingHits.join(","));
  assert.deepEqual(remainingHits, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  console.log("PASS: 11 MISS -> 11 cargas consumidas, igual a 11 HIT.\n");
}

// --- teste 3: 12o ataque, wall ja destruida ---
{
  const group = { val2: 1 };
  const first = safetyWallHook(group, BF_SHORT); // consome a ultima
  assert.equal(first.notified, 0);
  assert.equal(group.destroyed, true);
  // 12o ataque real: group já foi deletado (skill_delunitgroup), então
  // sce->getSCE(SC_SAFETYWALL) não existiria mais — aqui simulamos
  // passando group=null, que é o estado real pós-delete.
  const second = safetyWallHook(null, BF_SHORT);
  assert.equal(second.safetyWallBlock, false);
  assert.equal(second.notified, null);
  console.log("PASS: apos a wall cair, ataque seguinte nao consome nada.\n");
}

// --- teste 4: magia nunca entra (BF_MAGIC, nao BF_SHORT) ---
{
  const group = { val2: 11 };
  const result = safetyWallHook(group, BF_MAGIC);
  assert.equal(result.safetyWallBlock, false);
  assert.equal(group.val2, 11, "magia nao decrementa nada");
  console.log("PASS: BF_MAGIC nunca consome carga (guarda identica a battle.cpp).\n");
}

console.log("TODOS OS TESTES DO MODELO PASSARAM.");
