import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { cellInScope, type EditScope } from "./editScope";
import { editorGrid } from "./activeGrid";

/**
 * O que o ESCOPO deixa de fora, sombreado.
 *
 * Existe por causa de um relato que parecia bug e não era: "editando a parte de
 * dentro, o que era toda a área 400×400, ele me limitou a algumas edições, como
 * se já houvesse diretrizes dizendo onde é a borda". Havia — são as três regiões
 * do `editor/editScope`, e num mapa importado do rAthena elas saem da colisão do
 * `map_cache`.
 *
 * Medido no `prt_fild08` (400×400 = 160.000 células): **buraco 7.899, borda
 * 56.669, dentro 95.432**. Com "Dentro" escolhido, o pincel de relevo ainda
 * exige célula ANDÁVEL, e aí sobram 90.796 — **56,7% do mapa**. Os outros 43%
 * simplesmente não respondiam ao pincel, sem nada na tela dizendo por quê.
 *
 * A regra estava certa; o que faltava era ela ser visível. Regra invisível é
 * indistinguível de defeito.
 *
 * Só aparece com escopo restrito: em "Tudo" não há nada a marcar, e um véu
 * permanente sobre o mapa atrapalharia quem está autorando.
 */

/** altura do véu sobre o chão — acima do terreno, abaixo dos props */
const ALTURA = 0.05;

export function EscopoOverlay({ map, escopo }: { map: GameMap; escopo: EditScope }) {
  const geometria = useMemo(() => {
    if (escopo === "all") return null;
    const { width: W, height: H } = map.size;
    const grade = editorGrid();
    const meia = grade.cellWidth() / 2;

    /**
     * Um quad por célula FORA do escopo, tudo numa geometria só.
     *
     * Uma malha por célula seriam dezenas de milhares de objetos — o mesmo
     * motivo pelo qual o chão é chunk e não tile. Aqui nem chunk é preciso: o
     * véu é plano e sem cor por vértice, então um único buffer resolve, e ele é
     * refeito só quando a colisão do mapa ou o escopo mudam.
     */
    const pos: number[] = [];
    const idx: number[] = [];
    let n = 0;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        if (cellInScope(map, escopo, col, row)) continue;
        const { x, z } = grade.cellToWorld(col, row);
        // a altura acompanha o terreno para o véu não afundar num paredão nem
        // flutuar sobre uma ravina
        const y = grade.levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0) + ALTURA;
        pos.push(x - meia, y, z - meia, x + meia, y, z - meia, x + meia, y, z + meia, x - meia, y, z + meia);
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
        n += 4;
      }
    }
    if (n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.collision, map.surface, map.heightmap, map.size.width, map.size.height, escopo]);

  useEffect(() => () => geometria?.dispose(), [geometria]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#05070d",
        transparent: true,
        // forte o bastante para separar as duas regiões de relance, fraco o
        // bastante para ainda se ler o relevo por baixo — o jogador precisa
        // enxergar a montanha que NÃO vai poder editar
        opacity: 0.42,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  if (!geometria) return null;
  // `raycast` desligado: o véu cobre metade do mapa e engoliria o clique do
  // pincel na região de fora — que é onde o jogador clica para descobrir que
  // está fora
  return <mesh geometry={geometria} material={material} raycast={() => null} renderOrder={-1} />;
}
