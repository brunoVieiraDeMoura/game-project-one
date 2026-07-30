import { useEffect, useRef } from "react";
import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { gridFor } from "../grid";
import { legacyMapping, serverToLocal } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { Panel } from "../ui/rpg";

const SIZE = 150; // px do minimapa

/**
 * Minimapa (topo-direita): colisão do mapa reduzida + o player + as entidades.
 *
 * A posição é calculada em CÉLULAS, não em unidades de mundo. Antes ele dividia
 * a posição do player por `width × cellSize` — uma medida que não existe no
 * mundo hex (lá a largura é o passo do hexágono), então o ponto andava numa
 * escala diferente da do jogo: o personagem cruzava o mapa inteiro e o ponto
 * mal saía do canto.
 */
export function Minimap({ map, playerPos }: { map: GameMap; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLCanvasElement>(null);

  // desenha a colisão reduzida uma vez
  useEffect(() => {
    const c = bgRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { width, height } = map.size;
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = map.collision[y * width + x];
        // norte em cima: inverte y
        const di = ((height - 1 - y) * width + x) * 4;
        let r = 40, g = 70, b = 30;
        if (t === "wall") (r = 30), (g = 30), (b = 34);
        else if (t === "water") (r = 30), (g = 64), (b = 175);
        else if (t === "cliff") (r = 90), (g = 60), (b = 20);
        img.data[di] = r;
        img.data[di + 1] = g;
        img.data[di + 2] = b;
        img.data[di + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(off, 0, 0, SIZE, SIZE);
  }, [map]);

  // player e entidades por rAF
  useEffect(() => {
    const c = dotRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const mapping = legacyMapping(map);
    const { width, height } = map.size;
    const grid = gridFor(map);

    /** célula local (col,row) → pixel no minimapa, com norte em cima */
    const toPixel = (col: number, row: number) => ({
      x: ((col + 0.5) / width) * SIZE,
      y: ((height - 0.5 - row) / height) * SIZE,
    });

    const dot = (col: number, row: number, color: string, radius: number) => {
      if (col < 0 || row < 0 || col >= width || row >= height) return;
      const p = toPixel(col, row);
      ctx.fillStyle = color;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const world = useWorldStore.getState();
      const now = performance.now();

      if (mapping && world.selfGid) {
        // Com servidor: a fonte é a CÉLULA que ele confirmou — nada de derivar
        // de posição de mundo, que passa por escala e arredondamento.
        for (const entity of Object.values(world.entities)) {
          const cell = interpolatedCell(entity, now);
          const local = serverToLocal(mapping, Math.round(cell.x), Math.round(cell.y));
          dot(local.col, local.row, entity.kind === "npc" ? "#7dd3fc" : "#ef4444", 2);
        }
        const self = interpolatedCell(world.self, now);
        const local = serverToLocal(mapping, Math.round(self.x), Math.round(self.y));
        dot(local.col, local.row, "#fde047", 4);
      } else {
        // Sem servidor (preview do editor): converte a posição de mundo pela
        // MESMA grade que o terreno usa para desenhar.
        const p = playerPos.current;
        const cell = grid.worldToCell(p.x, p.z);
        dot(cell.col, cell.row, "#fde047", 4);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [map, playerPos]);

  return (
    <Panel style={{ width: SIZE + 8 }}>
      {/* Espelhado no eixo X. Vale para os DOIS canvas (colisão e pontos) de uma
          vez, então nenhum cálculo de célula muda — o nome do mapa fica fora do
          div, senão sairia escrito de trás para frente. */}
      <div
        style={{
          position: "relative",
          width: SIZE,
          height: SIZE,
          borderRadius: 4,
          overflow: "hidden",
          transform: "scaleX(-1)",
        }}
      >
        <canvas ref={bgRef} width={SIZE} height={SIZE} style={{ position: "absolute", inset: 0 }} />
        <canvas ref={dotRef} width={SIZE} height={SIZE} style={{ position: "absolute", inset: 0 }} />
      </div>
      <div style={{ textAlign: "center", font: "700 11px system-ui", color: "#493333", marginTop: 2 }}>{map.id}</div>
    </Panel>
  );
}
