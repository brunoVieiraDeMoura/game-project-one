import { parseSkillEntry, reemitRawSkillYaml } from "./rathena/skill-db-yaml.ts";

function scenario(name, ammoFlags) {
  const raw = {
    Id: 99999,
    Name: "AUDIT_SKILL",
    Description: "audit",
    MaxLevel: 1,
    Requires: ammoFlags
      ? { Ammo: ammoFlags, AmmoAmount: { Level1: 1 } }
      : undefined,
  };
  const parsed = parseSkillEntry(raw);
  const reemitted = reemitRawSkillYaml(parsed);
  console.log(`\n=== ${name} ===`);
  console.log("input Requires.Ammo:", ammoFlags);
  console.log("output Requires.Ammo:", reemitted.Requires?.Ammo);
  console.log("output Requires.AmmoAmount:", reemitted.Requires?.AmmoAmount);
}

// 1) no ammo requirement at all (admin never touched the field) — Requires undefined
scenario("sem Requires.Ammo (skill nova, sem requisito de munição)", undefined);

// 2) admin form sends all 10 ammo keys, all false (the exact shape that
// caused the original A29 bug — Object.keys().length was never 0)
const allFalse = Object.fromEntries(
  ["Arrow", "Throwable", "Bullet", "Shell", "Grenade", "Shuriken", "Kunai", "Cannonball", "ThrowWeapon", "None"].map(
    (k) => [k, false],
  ),
);
scenario("todas as 10 chaves presentes, todas false (formato real do admin)", allFalse);

// 3) single ammo type marked true
scenario("1 tipo de munição marcado (Arrow)", { ...allFalse, Arrow: true });

// 4) multiple ammo types marked true
scenario("múltiplos tipos marcados (Arrow + Bullet)", { ...allFalse, Arrow: true, Bullet: true });
