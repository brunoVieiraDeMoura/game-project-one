import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { gridFor } from "../grid";
import { legacyMapping, serverToLocal } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { MINIMAP_WIDTH, MM_ART, MM_COLORS, MM_LAYOUT, MM_PLATE, MM_ZOOM, isDaytime } from "../ui/minimap";
import { canvasDeColisao } from "./colisaoCanvas";
import { NotificationBell } from "./NotificationBell";

const escala = MINIMAP_WIDTH / MM_PLATE.w;
const px = (v: number) => v * escala;

/**
 * Quantas vezes por segundo o minimapa se redesenha.
 *
 * Ele tem um `requestAnimationFrame` PRÓPRIO, independente do laço do R3F, e
 * cada passada refaz `interpolatedCell` de TODA entidade (a mesma conta que o
 * `NetEntity` já fez naquele quadro), um `drawImage` da janela inteira e um arco
 * com traço por mob. Com ~25 mobs isso é uma segunda varredura completa do mundo
 * em Canvas2D, na mesma thread, 60 vezes por segundo — e rodava mesmo com todo
 * mundo parado.
 *
 * A 12 fps nada se perde: um mob anda uma célula a cada ~200 ms e a célula do
 * minimapa tem poucos pixels. O rAF continua sendo o relógio — é ele que faz o
 * laço parar quando a aba perde o foco; o limitador só decide quais quadros
 * desenham.
 */
const MINIMAPA_FPS = 12;

/**
 * Minimapa (topo-direita), vestido com a arte de `ui_definitiva/mini-map`.
 *
 * O mapa é a colisão reduzida, recortada num círculo e desenhada POR BAIXO da
 * moldura — o aro cobre a sobra, como o retrato faz na placa do personagem.
 *
 * A posição é calculada em CÉLULAS, não em unidades de mundo. Antes ele dividia
 * a posição do player por `width × cellSize` — uma medida que não existe no
 * mundo hex (lá a largura é o passo do hexágono), então o ponto andava numa
 * escala diferente da do jogo: o personagem cruzava o mapa inteiro e o ponto
 * mal saía do canto.
 */
export function Minimap({ map, playerPos }: { map: GameMap; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const [zoomIdx, setZoomIdx] = useState(0);
  const [hora, setHora] = useState(() => new Date());
  const viewRef = useRef<HTMLCanvasElement>(null);
  const setaRef = useRef<HTMLImageElement>(null);
  const anguloRef = useRef(0);

  const lado = px(MM_LAYOUT.circle.r * 2);

  // relógio: um tique a cada meio minuto basta para o "HH:MM" nunca atrasar
  useEffect(() => {
    const id = setInterval(() => setHora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Colisão pré-desenhada num canvas do TAMANHO DO MAPA (uma vez por mapa).
   *
   * O zoom depois só recorta um pedaço dele — redesenhar 160.000 células por
   * quadro para seguir o personagem seria impagável. Mora em `colisaoCanvas`
   * porque a janela do Alt+M desenha o MESMO mapa: com um canvas por tela seria
   * o dobro do bitmap (640 KB cada num 400×400) para o mesmo pixel.
   */
  const fonte = useMemo(() => canvasDeColisao(map), [map]);

  // mapa + entidades + seta, no ritmo de MINIMAPA_FPS
  useEffect(() => {
    const c = viewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const mapping = legacyMapping(map);
    const { width, height } = map.size;
    const grid = gridFor(map);
    const zoom = MM_ZOOM[zoomIdx] ?? 1;
    /** lado da janela recortada do mapa, em células */
    const janelaW = width / zoom;
    const janelaH = height / zoom;

    let raf = 0;
    let ultimoDesenho = 0;
    const intervalo = 1000 / MINIMAPA_FPS;
    const loop = () => {
      const now = performance.now();
      if (now - ultimoDesenho < intervalo) {
        raf = requestAnimationFrame(loop);
        return;
      }
      ultimoDesenho = now;
      const world = useWorldStore.getState();

      // onde está o personagem, em célula LOCAL do mapa
      let eu = { col: 0, row: 0 };
      let indo: { col: number; row: number } | null = null;
      if (mapping && world.selfGid) {
        const self = interpolatedCell(world.self, now);
        eu = serverToLocal(mapping, self.x, self.y);
        const destino = serverToLocal(mapping, world.self.toX, world.self.toY);
        if (destino.col !== eu.col || destino.row !== eu.row) indo = destino;
      } else {
        const p = playerPos.current;
        eu = grid.worldToCell(p.x, p.z);
      }

      // Janela centrada no personagem, presa às bordas do mapa: sem a trava, no
      // canto do mapa metade da vista seria vazio.
      const ox = Math.max(0, Math.min(width - janelaW, eu.col + 0.5 - janelaW / 2));
      // o canvas tem o y invertido (norte em cima), então a origem também
      const oyTopo = height - 0.5 - eu.row;
      const oy = Math.max(0, Math.min(height - janelaH, oyTopo - janelaH / 2));

      ctx.clearRect(0, 0, lado, lado);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fonte, ox, oy, janelaW, janelaH, 0, 0, lado, lado);

      /** célula local → pixel dentro da janela */
      const toPixel = (col: number, row: number) => ({
        x: ((col + 0.5 - ox) / janelaW) * lado,
        y: ((height - 0.5 - row - oy) / janelaH) * lado,
      });

      if (mapping && world.selfGid) {
        for (const entity of Object.values(world.entities)) {
          const cell = interpolatedCell(entity, now);
          const local = serverToLocal(mapping, Math.round(cell.x), Math.round(cell.y));
          const p = toPixel(local.col, local.row);
          if (p.x < 0 || p.y < 0 || p.x > lado || p.y > lado) continue;
          ctx.fillStyle = entity.kind === "npc" ? MM_COLORS.npc : MM_COLORS.mob;
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // A seta é um <img> FORA do canvas: o container do mapa é espelhado em X e
      // ela sairia invertida junto. Aqui só se acerta posição e ângulo — daí o
      // `lado - p.x`, que desfaz o espelho para esta camada.
      const seta = setaRef.current;
      if (seta) {
        const p = toPixel(eu.col, eu.row);
        if (indo) {
          // na tela: direita = coluna DECRESCENDO (por causa do espelho) e cima
          // = linha crescendo. A arte já aponta para cima em ângulo 0.
          anguloRef.current = Math.atan2(-(indo.col - eu.col), indo.row - eu.row);
        }
        seta.style.left = `${lado - p.x}px`;
        seta.style.top = `${p.y}px`;
        seta.style.transform = `translate(-50%,-50%) rotate(${anguloRef.current}rad)`;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [map, playerPos, fonte, zoomIdx, lado]);

  const dia = isDaytime(hora.getHours());
  const relogio = `${String(hora.getHours()).padStart(2, "0")}:${String(hora.getMinutes()).padStart(2, "0")}`;

  return (
    <div
      style={{
        position: "relative",
        width: MINIMAP_WIDTH,
        height: (MINIMAP_WIDTH * MM_PLATE.h) / MM_PLATE.w,
      }}
    >
      {/* mapa ATRÁS da moldura, recortado no círculo */}
      <div
        style={{
          position: "absolute",
          left: px(MM_LAYOUT.circle.cx - MM_LAYOUT.circle.r),
          top: px(MM_LAYOUT.circle.cy - MM_LAYOUT.circle.r),
          width: lado,
          height: lado,
          borderRadius: "50%",
          overflow: "hidden",
          background: "#1d2416",
        }}
      >
        {/* espelhado em X, como antes — o nome do mapa fica FORA daqui, senão
            sairia escrito de trás para frente */}
        <canvas
          ref={viewRef}
          width={lado}
          height={lado}
          style={{ position: "absolute", inset: 0, transform: "scaleX(-1)" }}
        />
        <img
          ref={setaRef}
          src={MM_ART.player}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            width: px(MM_LAYOUT.player.w),
            height: px(MM_LAYOUT.player.h),
            transformOrigin: "50% 50%",
            pointerEvents: "none",
          }}
        />
      </div>

      <img
        src={MM_ART.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      <div
        style={{
          position: "absolute",
          left: px(MM_LAYOUT.namePlate.x),
          top: px(MM_LAYOUT.namePlate.y),
          width: px(MM_LAYOUT.namePlate.w),
          height: px(MM_LAYOUT.namePlate.h),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(24),
          lineHeight: 1,
          color: MM_COLORS.ink,
          textShadow: `0 1px 2px ${MM_COLORS.shadow}`,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {map.name ?? map.id}
      </div>

      <div
        style={{
          position: "absolute",
          left: px(MM_LAYOUT.clockPlate.x),
          top: px(MM_LAYOUT.clockPlate.y),
          width: px(MM_LAYOUT.clockPlate.w),
          height: px(MM_LAYOUT.clockPlate.h),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: px(14),
          pointerEvents: "none",
        }}
      >
        <img src={dia ? MM_ART.sun : MM_ART.moon} alt="" draggable={false} style={{ height: px(26) }} />
        <span
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 700,
            fontSize: px(26),
            lineHeight: 1,
            color: MM_COLORS.ink,
            textShadow: `0 1px 2px ${MM_COLORS.shadow}`,
          }}
        >
          {relogio}
        </span>
      </div>

      <BotaoZoom
        art={MM_ART.zoomOut}
        titulo="Afastar"
        desabilitado={zoomIdx === 0}
        onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
        lado="left"
      />
      <BotaoZoom
        art={MM_ART.zoomIn}
        titulo="Aproximar"
        desabilitado={zoomIdx === MM_ZOOM.length - 1}
        onClick={() => setZoomIdx((i) => Math.min(MM_ZOOM.length - 1, i + 1))}
        lado="right"
      />

      <div
        style={{
          position: "absolute",
          left: px(MM_LAYOUT.bellRing.cx - MM_LAYOUT.bellRing.d / 2),
          top: px(MM_LAYOUT.bellRing.cy - MM_LAYOUT.bellRing.d / 2),
        }}
      >
        <NotificationBell size={px(MM_LAYOUT.bellRing.d)} />
      </div>
    </div>
  );
}

/** botão de zoom, centrado NO aro (meia altura, esquerda ou direita) */
function BotaoZoom({
  art,
  titulo,
  desabilitado,
  onClick,
  lado,
}: {
  art: string;
  titulo: string;
  desabilitado: boolean;
  onClick: () => void;
  lado: "left" | "right";
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const d = px(MM_LAYOUT.zoom.d);
  const cx = MM_LAYOUT.circle.cx + (lado === "left" ? -MM_LAYOUT.circle.r : MM_LAYOUT.circle.r);
  const escalaBotao = pressed ? "scale(0.9)" : hover && !desabilitado ? "scale(1.1)" : "scale(1)";

  return (
    <button
      onClick={onClick}
      title={titulo}
      disabled={desabilitado}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      style={{
        position: "absolute",
        left: px(cx) - d / 2,
        top: px(MM_LAYOUT.circle.cy) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        lineHeight: 0,
        cursor: desabilitado ? "default" : "pointer",
        opacity: desabilitado ? 0.45 : 1,
        transform: escalaBotao,
        filter: hover && !desabilitado ? "brightness(1.15)" : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out, opacity 110ms ease-out",
      }}
    >
      <img src={art} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />
    </button>
  );
}
