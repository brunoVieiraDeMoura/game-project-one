import { beforeEach, describe, expect, it } from "vitest";
import { useWorldStore } from "./worldStore";

/**
 * Regressão da barra de HP voltando pro valor cheio depois de um hit
 * ("auditoria barra de vida" 2026-08-19).
 *
 * Causa raiz: `STANDENTRY`/`NEWENTRY`/`ACTENTRY`/`MOVEENTRY` reanunciam a
 * entidade (o rAthena manda de novo sempre que ela reentra em área de
 * visão/muda de estado) e todos passam por `world.spawn()` — que reaplicava
 * `e.hp`/`e.maxHp` do pacote de entrada (o HP de quando o mob nasceu, cheio)
 * por cima do HP AO VIVO que `setHp()` (dano real, `entity:hp`) já tinha
 * escrito. `hpAoVivo` é a guarda: uma vez que `setHp` fala por um gid, só ele
 * pode voltar a escrever `hp`/`maxHp` daquele gid — `spawn()` continua livre
 * pra atualizar posição/nome/nível/etc.
 */
const mundo = () => useWorldStore.getState();

function nascerMob(gid: number, hp?: number, maxHp?: number) {
  mundo().spawn({ gid, kind: "mob", job: 1002, x: 20, y: 20, dir: 0, speed: 150, hp, maxHp });
}

beforeEach(() => {
  mundo().clear();
});

describe("HP ao vivo sobrevive a reannounce de spawn", () => {
  it("hit real não é desfeito por um MOVEENTRY/STANDENTRY chegando depois", () => {
    nascerMob(1, 1000, 1000);
    expect(mundo().entities[1]?.hp).toBe(1000);

    // dano real: HP_INFO_TINY/NOTIFY_MONSTER_HP → gateway → setHp
    mundo().setHp(1, 500, 1000);
    expect(mundo().entities[1]?.hp).toBe(500);

    // reannounce (rAthena manda o pacote de entrada de novo, com o HP de
    // quando o mob nasceu — cheio) — não pode reverter o HP ao vivo
    nascerMob(1, 1000, 1000);
    expect(mundo().entities[1]?.hp).toBe(500);
    expect(mundo().entities[1]?.maxHp).toBe(1000);
  });

  it("vários hits rápidos, cada um sobrevive ao reannounce seguinte", () => {
    nascerMob(1, 1000, 1000);
    for (const hp of [900, 800, 700, 600, 500]) {
      mundo().setHp(1, hp, 1000);
      nascerMob(1, 1000, 1000); // reannounce logo depois de cada hit
      expect(mundo().entities[1]?.hp).toBe(hp);
    }
  });

  it("a guarda é por gid — dano num mob não trava o HP inicial de outro", () => {
    nascerMob(1, 1000, 1000);
    nascerMob(2, 1000, 1000);

    mundo().setHp(1, 500, 1000);
    // mob 2 nunca levou dano: seu PRIMEIRO spawn ainda deve valer normalmente
    nascerMob(2, 1000, 1000);

    expect(mundo().entities[1]?.hp).toBe(500);
    expect(mundo().entities[2]?.hp).toBe(1000);
  });

  it("entidade nova (sem HP ao vivo ainda) continua aceitando HP do spawn normalmente", () => {
    nascerMob(1); // spawn sem hp/maxHp (pacote antigo, sem show_mob_info ainda)
    expect(mundo().entities[1]?.hp).toBeUndefined();

    nascerMob(1, 1000, 1000); // reannounce chega já com o HP — nenhum setHp ainda rodou
    expect(mundo().entities[1]?.hp).toBe(1000);
  });

  it("morte (HP 0) continua se propagando normalmente", () => {
    nascerMob(1, 1000, 1000);
    mundo().setHp(1, 0, 1000);
    expect(mundo().entities[1]?.hp).toBe(0);
    nascerMob(1, 1000, 1000);
    expect(mundo().entities[1]?.hp).toBe(0);
  });

  it("vanish limpa o marcador — um gid reaproveitado nasce livre de novo", () => {
    nascerMob(1, 1000, 1000);
    mundo().setHp(1, 500, 1000);
    mundo().vanish(1);

    nascerMob(1, 1000, 1000); // mesmo gid, entidade nova de verdade
    expect(mundo().entities[1]?.hp).toBe(1000);
  });

  it("spawn continua livre para atualizar nome/nível/posição sob HP ao vivo", () => {
    nascerMob(1, 1000, 1000);
    mundo().setHp(1, 500, 1000);
    mundo().spawn({ gid: 1, kind: "mob", job: 1002, name: "Poring", level: 7, x: 22, y: 24, dir: 3, speed: 150, hp: 1000, maxHp: 1000 });

    const e = mundo().entities[1]!;
    expect(e.hp).toBe(500);
    expect(e.maxHp).toBe(1000);
    expect(e.name).toBe("Poring");
    expect(e.level).toBe(7);
    expect(e.x).toBe(22);
    expect(e.y).toBe(24);
  });
});
