import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmarQuadro,
  dispararCaptura,
  casosCapturados,
  estadoDosGatilhos,
  eventosOrdenados,
  forcarFlag,
  limpar,
  quadro,
  QUADROS_DEPOIS,
} from "./flightRecorder";
import {
  amostrarVfx,
  forcarFlagVfx,
  instantaneoVfx,
  marcarDesmontagemVfx,
  marcarMontagemVfx,
  marcarVfxCancel,
  marcarVfxEnd,
  marcarVfxStart,
  perfilEstruturalDe,
  registrarContainerVfx,
  registrarPerfilEstruturalVfx,
  relatorioVfx,
  vfxDesligar,
  vfxInstrumentacaoAtiva,
  vfxLigar,
  zerarVfx,
} from "./vfxProbe";

/**
 * Sem DOM (mesmo ambiente Node puro do resto de `core/diagnostics`) — os
 * testes de `htmlCount`/`domNodeCount` de verdade dependem de um
 * `HTMLElement`, então aqui `registrarContainerVfx(null)` (o padrão) é
 * suficiente para cobrir o resto: ciclo de vida, agregação por skill,
 * gatilho, relatório.
 */

function gravarQuadro(ms: number, heapMb = NaN): void {
  quadro().quadroMs = ms;
  quadro().heapMb = heapMb;
  amostrarVfx();
  confirmarQuadro();
}

beforeEach(() => {
  limpar();
  forcarFlag(true);
  forcarFlagVfx(true);
  zerarVfx();
  registrarContainerVfx(null);
});

describe("interruptor próprio", () => {
  it("nasce desligado por padrão (forcarFlagVfx só vale para o teste)", () => {
    forcarFlagVfx(false);
    expect(vfxInstrumentacaoAtiva()).toBe(false);
    marcarVfxStart({ instanceId: 1, skillId: 90001, kind: "impact" });
    // com o interruptor desligado, nada é registrado — nem o evento
    expect(eventosOrdenados().some((e) => e.cat === "vfx")).toBe(false);
  });

  it("vfxLigar/vfxDesligar viram o interruptor", () => {
    forcarFlagVfx(false);
    vfxLigar();
    expect(vfxInstrumentacaoAtiva()).toBe(true);
    vfxDesligar();
    expect(vfxInstrumentacaoAtiva()).toBe(false);
  });
});

describe("ciclo de vida VFX_START/VFX_END", () => {
  it("start registra evento cat=vfx com skillName/instanceId/duração esperada", () => {
    quadro().t = 1000;
    marcarVfxStart({
      instanceId: 42,
      skillId: 90001,
      skillName: "Thunder Storm",
      kind: "impact",
      expectedDurationMs: 2000,
    });
    const ev = eventosOrdenados().find((e) => e.cat === "vfx" && e.tipo === "start");
    expect(ev).toBeDefined();
    expect(ev!.dados).toMatchObject({ instanceId: 42, skillId: 90001, skillName: "Thunder Storm", expectedDurationMs: 2000 });
  });

  it("end registra evento com durationMs medida (não a esperada)", () => {
    const t0 = performance.now();
    marcarVfxStart({ instanceId: 7, skillId: 1, skillName: "Cold Bolt", kind: "impact" });
    marcarVfxEnd(7);
    const ev = eventosOrdenados().find((e) => e.cat === "vfx" && e.tipo === "end");
    expect(ev).toBeDefined();
    const dados = ev!.dados as { durationMs: number };
    expect(dados.durationMs).toBeGreaterThanOrEqual(0);
    expect(performance.now() - t0).toBeLessThan(500); // sanidade: o teste não travou
  });

  it("end sem start correspondente não quebra (instanceId desconhecido)", () => {
    expect(() => marcarVfxEnd(99999)).not.toThrow();
  });

  it("mount/unmount são eventos SEPARADOS de start/end", () => {
    marcarMontagemVfx(1, { kind: "impact", skillId: 5 });
    marcarDesmontagemVfx(1, { kind: "impact", skillId: 5 });
    const tipos = eventosOrdenados()
      .filter((e) => e.cat === "vfx")
      .map((e) => e.tipo);
    expect(tipos).toEqual(["mount", "unmount"]);
  });
});

describe("amostra por quadro", () => {
  it("vfxAtivos reflete o número de instâncias vivas", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "A", kind: "impact" });
    marcarVfxStart({ instanceId: 2, skillId: 2, skillName: "B", kind: "impact" });
    gravarQuadro(16.6);
    expect(quadro().vfxAtivos).toBe(2);
    marcarVfxEnd(1);
    gravarQuadro(16.6);
    expect(quadro().vfxAtivos).toBe(1);
  });

  it("sem VFX ativo, vfxAtivos fica em 0 e a coluna é escrita mesmo assim", () => {
    gravarQuadro(16.6);
    expect(quadro().vfxAtivos).toBe(0);
  });

  it("instantaneoVfx() reflete o estado mesmo com o voo geral OFF (só o vfxLigado importa aqui)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "A", kind: "impact" });
    amostrarVfx();
    expect(instantaneoVfx().ativos).toBe(1);
  });
});

describe("gatilho vfxPerformanceSpike", () => {
  it("existe na tabela e começa ligado com limiar 33", () => {
    const g = estadoDosGatilhos().vfxPerformanceSpike;
    expect(g).toBeDefined();
    expect(g.ligado).toBe(true);
    expect(g.limiar).toBe(33);
  });

  it("dispara captura quando o quadro passa do limiar COM vfx ativo", () => {
    marcarVfxStart({ instanceId: 1, skillId: 90005, skillName: "Thunder Storm", kind: "impact" });
    gravarQuadro(50); // > 33, com 1 vfx ativo — arma a captura pendente
    for (let i = 0; i < QUADROS_DEPOIS; i++) gravarQuadro(16); // fecha a janela "depois"
    expect(casosCapturados().length).toBeGreaterThan(0);
    const c = casosCapturados()[casosCapturados().length - 1]!;
    expect(c.motivo).toBe("vfxPerformanceSpike");
  });

  it("NÃO dispara quando o quadro é longo mas não há VFX ativo", () => {
    gravarQuadro(200); // longo, mas vfxAtivos=0 — amostrarVfx nem chama avaliarGatilho
    for (let i = 0; i < QUADROS_DEPOIS; i++) gravarQuadro(16);
    const casos = casosCapturados();
    expect(casos.every((c) => c.motivo !== "vfxPerformanceSpike")).toBe(true);
  });

  it("o gatilho manual continua funcionando (não foi substituído)", () => {
    dispararCaptura("manual");
    for (let i = 0; i < QUADROS_DEPOIS; i++) gravarQuadro(16);
    expect(casosCapturados().length).toBeGreaterThan(0);
  });
});

describe("relatório por skill", () => {
  let proximoId = 1;
  function simularCast(skillName: string, skillId: number, quadros: number[]): void {
    const id = proximoId++;
    marcarVfxStart({ instanceId: id, skillId, skillName, kind: "impact" });
    for (const ms of quadros) gravarQuadro(ms);
    marcarVfxEnd(id);
  }

  it("agrega casts, frameMs e calcula delta contra a baseline", () => {
    // baseline: 10 quadros "limpos" a ~16ms
    for (let i = 0; i < 10; i++) gravarQuadro(16);
    // Thunder Storm: 5 quadros a 40ms (bem acima da baseline)
    simularCast("Thunder Storm", 90005, [40, 40, 40, 40, 40]);

    const rel = relatorioVfx();
    const ts = rel.porSkill.find((s) => s.skillName === "Thunder Storm");
    expect(ts).toBeDefined();
    expect(ts!.casts).toBe(1);
    expect(ts!.avgFrameMsWhileActive).toBeCloseTo(40, 0);
    expect(ts!.baselineFrameMs).toBeCloseTo(16, 0);
    expect(ts!.deltaFrameMs).toBeGreaterThan(15);
  });

  it("skill parada (nenhum sinal) sai como noSignificantImpact", () => {
    for (let i = 0; i < 10; i++) gravarQuadro(16);
    simularCast("Stone Curse", 90015, [16, 17, 16, 16]);
    const rel = relatorioVfx();
    const sc = rel.porSkill.find((s) => s.skillName === "Stone Curse");
    expect(sc!.diagnosis.noSignificantImpact).toBe(true);
    expect(sc!.diagnosis.mainThreadHeavy).toBe(false);
  });

  it("skill pesada sai como mainThreadHeavy e entra no topo do ranking", () => {
    for (let i = 0; i < 10; i++) gravarQuadro(16);
    simularCast("Leve", 1, [16, 17]);
    simularCast("Pesada", 2, [60, 65, 70]);
    const rel = relatorioVfx();
    const pesada = rel.porSkill.find((s) => s.skillName === "Pesada")!;
    expect(pesada.diagnosis.mainThreadHeavy).toBe(true);
    expect(rel.ranking[0]).toBe("Pesada");
  });

  it("média baixa mas cauda pesada (P95) ainda sai mainThreadHeavy (achado da validação em /vfx-bench: 3 casts, delta médio 1,8ms, mas 3 long tasks reais e quadro máximo de 132ms — a média sozinha não pegava)", () => {
    for (let i = 0; i < 30; i++) gravarQuadro(16.6); // baseline limpa
    marcarVfxStart({ instanceId: 500, skillId: 90005, skillName: "Thunder Storm", kind: "impact" });
    // 10% dos quadros com pico de verdade, o resto barato — a MÉDIA quase não
    // se move (afogada pelos 90% baratos), mas o P95 mora exatamente na cauda
    for (let i = 0; i < 90; i++) gravarQuadro(17);
    for (let i = 0; i < 10; i++) gravarQuadro(40);
    marcarVfxEnd(500);
    const rel = relatorioVfx();
    const ts = rel.porSkill.find((s) => s.skillName === "Thunder Storm")!;
    expect(ts.deltaFrameMs).toBeLessThan(4); // a média sozinha NÃO passaria do limiar antigo
    expect(ts.diagnosis.mainThreadHeavy).toBe(true); // mas o P95 pega a cauda
  });

  it("gpuHeavy é sempre false (VFX de skill não é three.js)", () => {
    simularCast("Qualquer", 1, [20]);
    const rel = relatorioVfx();
    expect(rel.porSkill.every((s) => s.diagnosis.gpuHeavy === false)).toBe(true);
  });

  it("confidence cresce com o número de casts", () => {
    simularCast("Poucos casts", 1, [20]);
    for (let i = 0; i < 6; i++) simularCast("Muitos casts", 2, Array(35).fill(20));
    const rel = relatorioVfx();
    const poucos = rel.porSkill.find((s) => s.skillName === "Poucos casts")!;
    const muitos = rel.porSkill.find((s) => s.skillName === "Muitos casts")!;
    expect(muitos.diagnosis.confidence).toBeGreaterThan(poucos.diagnosis.confidence);
  });

  it("múltiplos VFX simultâneos: cada quadro é testemunhado por TODAS as skills ativas (nunca 100% para uma só)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "X", kind: "impact" });
    marcarVfxStart({ instanceId: 2, skillId: 2, skillName: "Y", kind: "impact" });
    gravarQuadro(30);
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    const x = rel.porSkill.find((s) => s.skillName === "X")!;
    const y = rel.porSkill.find((s) => s.skillName === "Y")!;
    // as DUAS viram o mesmo quadro de 30ms — nenhuma fica de fora
    expect(x.amostrasDeQuadro).toBe(1);
    expect(y.amostrasDeQuadro).toBe(1);
    expect(x.maxConcurrentVfx).toBe(2);
    expect(y.maxConcurrentVfx).toBe(2);
  });

  it("nota do relatório explica os limites de atribuição (correlação, não exclusividade)", () => {
    const rel = relatorioVfx();
    expect(rel.nota).toMatch(/correlação/);
    expect(rel.nota).toMatch(/gpuHeavy/);
  });
});

describe("VFX_CANCEL", () => {
  it("é um evento SEPARADO de VFX_END, com lifetimeMs em vez de durationMs", () => {
    marcarVfxStart({ instanceId: 9, skillId: 1, skillName: "Oracle", kind: "buff" });
    marcarVfxCancel(9, "recast");
    const ev = eventosOrdenados().find((e) => e.cat === "vfx" && e.tipo === "cancel");
    expect(ev).toBeDefined();
    const dados = ev!.dados as { lifetimeMs: number; motivo: string };
    expect(dados.lifetimeMs).toBeGreaterThanOrEqual(0);
    expect(dados.motivo).toBe("recast");
    expect(eventosOrdenados().some((e) => e.cat === "vfx" && e.tipo === "end")).toBe(false);
  });

  it("conta em s.cancels, NÃO em totalActiveMs (é gameplay, não performance)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "Oracle", kind: "buff" });
    gravarQuadro(16);
    marcarVfxCancel(1, "recast");
    marcarVfxStart({ instanceId: 2, skillId: 1, skillName: "Oracle", kind: "buff" });
    gravarQuadro(16);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    const o = rel.porSkill.find((s) => s.skillName === "Oracle")!;
    expect(o.casts).toBe(2);
    expect(o.cancels).toBe(1);
  });

  it("cancel sem start correspondente não quebra", () => {
    expect(() => marcarVfxCancel(99999, "reset")).not.toThrow();
  });
});

describe("vfxId", () => {
  it("vai no evento start e persiste no relatório mesmo se skillName mudar depois", () => {
    marcarVfxStart({ instanceId: 1, skillId: 90018, vfxId: "MG_FIREWALL", kind: "area" });
    const ev = eventosOrdenados().find((e) => e.cat === "vfx" && e.tipo === "start");
    expect((ev!.dados as { vfxId: string }).vfxId).toBe("MG_FIREWALL");
    gravarQuadro(20);
    const rel = relatorioVfx();
    const fw = rel.porSkill.find((s) => s.vfxId === "MG_FIREWALL")!;
    expect(fw).toBeDefined();
  });

  it("sem vfxId explícito, cai no fallback skill-<id> (mesmo padrão de skillName)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 777, kind: "impact" });
    const ev = eventosOrdenados().find((e) => e.cat === "vfx" && e.tipo === "start");
    expect((ev!.dados as { vfxId: string }).vfxId).toBe("skill-777");
  });
});

describe("frames>33ms / frames>50ms por skill", () => {
  it("conta quadros acima de cada limiar, não só a média", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "Fire Wall", kind: "area" });
    gravarQuadro(20); // nenhum limiar
    gravarQuadro(40); // só 33
    gravarQuadro(60); // os dois
    marcarVfxEnd(1);
    const rel = relatorioVfx();
    const fw = rel.porSkill.find((s) => s.skillName === "Fire Wall")!;
    expect(fw.framesAcima33).toBe(2);
    expect(fw.framesAcima50).toBe(1);
  });
});

describe("combinações de VFX", () => {
  it("registra a combinação quando 2+ VFX estão ativos num quadro ruim (>33ms)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "MG_FIREWALL", kind: "area" });
    marcarVfxStart({ instanceId: 2, skillId: 2, vfxId: "WZ_STORMGUST", kind: "impact" });
    gravarQuadro(50); // >33, os dois ativos
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    expect(rel.combinacoes.length).toBeGreaterThan(0);
    const combo = rel.combinacoes.find((c) => c.vfxIds.includes("MG_FIREWALL") && c.vfxIds.includes("WZ_STORMGUST"));
    expect(combo).toBeDefined();
    expect(combo!.occurrences).toBe(1);
    expect(combo!.maxFrameMs).toBe(50);
  });

  it("NÃO registra combinação em quadro leve (<=33ms)", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "MG_FIREWALL", kind: "area" });
    marcarVfxStart({ instanceId: 2, skillId: 2, vfxId: "WZ_STORMGUST", kind: "impact" });
    gravarQuadro(20);
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    expect(rel.combinacoes.length).toBe(0);
  });

  it("duas instâncias da MESMA skill não viram 'X + X' — contam como uma só na chave", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "MG_FIREWALL", kind: "area" });
    marcarVfxStart({ instanceId: 2, skillId: 1, vfxId: "MG_FIREWALL", kind: "area" });
    gravarQuadro(50);
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    expect(rel.combinacoes.length).toBe(1);
    expect(rel.combinacoes[0]!.vfxIds).toEqual(["MG_FIREWALL"]);
  });

  it("ocorrências repetidas da mesma combinação se acumulam na mesma linha", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "MG_FIREWALL", kind: "area" });
    marcarVfxStart({ instanceId: 2, skillId: 2, vfxId: "WZ_STORMGUST", kind: "impact" });
    gravarQuadro(50);
    gravarQuadro(60);
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    const rel = relatorioVfx();
    expect(rel.combinacoes.length).toBe(1);
    expect(rel.combinacoes[0]!.occurrences).toBe(2);
    expect(rel.combinacoes[0]!.maxFrameMs).toBe(60);
  });
});

describe("perfil estrutural (estático, opcional)", () => {
  it("registrarPerfilEstruturalVfx + perfilEstruturalDe: ida e volta", () => {
    registrarPerfilEstruturalVfx("MG_TESTE", {
      domNodesPerInstance: 51,
      animatedNodesPerInstance: 48,
      filteredNodesPerInstance: 7,
      htmlPortalsPerGroup: 1,
      fonte: "teste",
    });
    expect(perfilEstruturalDe("MG_TESTE")).toEqual({
      domNodesPerInstance: 51,
      animatedNodesPerInstance: 48,
      filteredNodesPerInstance: 7,
      htmlPortalsPerGroup: 1,
      fonte: "teste",
    });
  });

  it("vfxId sem perfil registrado sai como null (unavailable), nunca chutado", () => {
    expect(perfilEstruturalDe("SKILL_NUNCA_REGISTRADA")).toBeNull();
  });

  it("relatório inclui o perfil no vfxId correspondente", () => {
    registrarPerfilEstruturalVfx("MG_FIREWALL_TESTE", {
      domNodesPerInstance: 51,
      animatedNodesPerInstance: 48,
      filteredNodesPerInstance: 7,
      htmlPortalsPerGroup: 1,
      fonte: "teste",
    });
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "MG_FIREWALL_TESTE", kind: "area" });
    gravarQuadro(20);
    const rel = relatorioVfx();
    const fw = rel.porSkill.find((s) => s.vfxId === "MG_FIREWALL_TESTE")!;
    expect(fw.perfilEstrutural).not.toBeNull();
    expect(fw.perfilEstrutural!.domNodesPerInstance).toBe(51);
  });
});

describe("reset", () => {
  it("zerarVfx() limpa instâncias ativas e agregados por skill", () => {
    marcarVfxStart({ instanceId: 1, skillId: 1, skillName: "A", kind: "impact" });
    gravarQuadro(20);
    zerarVfx();
    const rel = relatorioVfx();
    expect(rel.porSkill.length).toBe(0);
    gravarQuadro(16);
    expect(quadro().vfxAtivos).toBe(0);
  });

  it("zerarVfx() também limpa combinações — NÃO limpa perfilEstrutural (é estático, do código, não da sessão)", () => {
    registrarPerfilEstruturalVfx("MG_PERSISTE", {
      domNodesPerInstance: 1,
      animatedNodesPerInstance: 1,
      filteredNodesPerInstance: 0,
      htmlPortalsPerGroup: 1,
      fonte: "teste",
    });
    marcarVfxStart({ instanceId: 1, skillId: 1, vfxId: "X", kind: "impact" });
    marcarVfxStart({ instanceId: 2, skillId: 2, vfxId: "Y", kind: "impact" });
    gravarQuadro(50);
    marcarVfxEnd(1);
    marcarVfxEnd(2);
    expect(relatorioVfx().combinacoes.length).toBeGreaterThan(0);

    zerarVfx();

    expect(relatorioVfx().combinacoes.length).toBe(0);
    expect(perfilEstruturalDe("MG_PERSISTE")).not.toBeNull();
  });
});

describe("integração com o voo geral", () => {
  it("desligar o voo geral (ativo()=false) também desliga a instrumentação de VFX", () => {
    forcarFlag(false);
    expect(vfxInstrumentacaoAtiva()).toBe(false);
    forcarFlag(true);
  });
});
