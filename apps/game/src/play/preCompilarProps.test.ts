import { describe, expect, it } from "vitest";
import type { MapProp } from "@ragnarok/map-format";
import { Y_DEPOSITO, especies } from "./PreCompilarProps";

/**
 * O aquecimento de materiais existe por um número medido, não por precaução.
 *
 * `voo-1785940564494.json`, quadro 227: **207,6 ms** de quadro com `renderMs`
 * 190,4 e `gpuMs` 193,9 — 92% dentro de `gl.render` —, `longtask` de 197 ms
 * marcada como UMA tarefa, e `programas` subindo de 19 para 20 naquele quadro.
 * `contextoMs`, `descarteMs` e `modeloMs` deram ZERO: não era criar contexto
 * (8 ms, medido), nem descartar renderer, nem clonar modelo. Era compilar
 * shader no primeiro `draw` de uma espécie de prop que acabara de entrar no
 * culling.
 *
 * O que este teste protege é a REDUÇÃO: um mapa tem milhares de props e poucas
 * dezenas de espécies, e aquecer por instância seria montar o mapa inteiro
 * atrás da cortina.
 */

const prop = (id: string, assetId: string, extra: Partial<MapProp> = {}): MapProp => ({
  id,
  assetId,
  position: [10, 2, 30],
  rotation: [0, 1.5, 0],
  scale: [3, 3, 3],
  ...extra,
});

describe("espécies a pré-compilar", () => {
  it("reduz a UMA por assetId — é o material que compila, não a instância", () => {
    const props = [
      prop("a1", "tree_01"),
      prop("a2", "tree_01"),
      prop("a3", "rock_03"),
      prop("a4", "tree_01"),
      prop("a5", "rock_03"),
    ];
    const fora = especies(props);
    expect(fora.map((p) => p.assetId)).toEqual(["tree_01", "rock_03"]);
  });

  it("põe tudo FORA do frustum — nada pode piscar na tela", () => {
    for (const p of especies([prop("a1", "tree_01")])) {
      expect(p.position[1]).toBe(Y_DEPOSITO);
      expect(p.position[0]).toBe(0);
      expect(p.position[2]).toBe(0);
    }
  });

  it("normaliza rotação e ESCALA", () => {
    /**
     * A escala do mapa não muda o material, e uma escala 0 (que o editor
     * consegue produzir) esconderia a malha — sem malha desenhada não há
     * programa compilado, e a correção se desligaria em silêncio.
     */
    const [p] = especies([prop("a1", "tree_01", { scale: [0, 0, 0], rotation: [1, 2, 3] })]);
    expect(p!.scale).toEqual([1, 1, 1]);
    expect(p!.rotation).toEqual([0, 0, 0]);
  });

  it("não colide de id com os props de verdade do mapa", () => {
    // os dois conjuntos convivem na mesma cena durante o aquecimento, e id
    // repetido viraria `key` repetida no React
    const [p] = especies([prop("a1", "tree_01")]);
    expect(p!.id).toBe("precompilar:tree_01");
  });

  it("mapa sem props devolve lista vazia (o efeito sai cedo)", () => {
    expect(especies([])).toEqual([]);
  });
});
