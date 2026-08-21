import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { gridFor } from "../grid";
import { legacyMapping, localToServer, serverToLocal } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { MM_ART, MM_COLORS } from "../ui/minimap";
import { CHROME, TYPE } from "../ui/windowChrome";
import {
  GRID_MIN_PX,
  GRID_STEP,
  MAP_ART,
  MAP_COLORS,
  MAP_LAYOUT,
  MAP_PLATE,
  MAP_TABS,
  MAP_WIDTH,
  MAP_ZOOM,
  NAME_PLATE,
  WORLD_SIZE,
  enquadrar,
  panAoAproximar,
  type MapTab,
} from "../ui/mapWindow";
import { canvasDeColisao } from "./colisaoCanvas";
import { ChatFrame } from "./ChatFrame";
import { useHudStore } from "./hudStore";
import { subscribeHudTick } from "./hudTick";

const escala = MAP_WIDTH / MAP_PLATE.w;
const px = (v: number) => v * escala;
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});

/**
 * Escala da moldura de folhagem.
 *
 * O `ChatFrame` já é parametrizado (chat 0,5 · login 0,72) porque os cantos são
 * DESENHOS diferentes e o alinhamento medido entre as oito peças é a parte
 * difícil — copiar o componente para trocar um número duplicaria isso. Aqui vai
 * 0,62: a janela tem ~900 px, entre o chat (~800) e o painel do login.
 */
const FRAME_ESCALA = 0.62;

/**
 * Quantas vezes por segundo o mapa se redesenha.
 *
 * Mesma razão do minimapa (`MINIMAPA_FPS`): cada passada refaz
 * `interpolatedCell` de TODA entidade e um `drawImage` do mapa inteiro, em
 * Canvas2D e na mesma thread do jogo. 20 fps é mais que o minimapa porque aqui
 * a célula tem muito mais pixel — o passo do mob fica visível —, e ainda assim é
 * um terço do quadro do jogo.
 *
 * T7 (`docs/otimizacao-heuristicas.md`): mesma migração do minimapa — o gate
 * manual (`now - ultimo < intervalo`) virou o parâmetro `hz` de
 * `hud/hudTick.ts: subscribeHudTick`, relógio COMPARTILHADO do HUD em vez de
 * um `requestAnimationFrame` próprio desta janela. Taxa efetiva continua
 * 20fps, comportamento idêntico a antes.
 */
const MAPA_FPS = 20;

/**
 * Janela de Mapa (Alt+M), vestida com a arte de `ui_definitiva/mapa`.
 *
 * Duas abas, e elas mostram coisas de naturezas DIFERENTES:
 *
 * - **Mapa atual**: a colisão do mapa em que o personagem está, com os mobs e
 *   NPCs que o servidor anunciou e a seta do jogador. É o minimapa em tamanho
 *   grande, e por isso compartilha com ele o canvas de colisão
 *   (`hud/colisaoCanvas`) e a paleta (`MM_COLORS`) — duas telas mostrando o
 *   mesmo mapa com cores diferentes seriam lidas como dois lugares.
 * - **Mundo**: o mapa-múndi pintado. Não há vínculo entre ele e os mapas do
 *   rAthena, e por isso ele NÃO leva marcador de "você está aqui" — inventar a
 *   posição seria pior que a lacuna (é a mesma regra da linha "—" da Lista de
 *   Amigos). Quando existir uma tabela de região, o marcador entra sem mexer no
 *   resto da tela.
 *
 * Como a Lista de Amigos, ela não entra no `Panel` genérico de `Windows.tsx`.
 */
export function MapWindow({
  map,
  playerPos,
}: {
  map: GameMap;
  playerPos: React.MutableRefObject<THREE.Vector3>;
}) {
  const [aba, setAba] = useState<MapTab>("atual");
  const [zoomIdx, setZoomIdx] = useState(0);
  const campoRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setaRef = useRef<HTMLImageElement>(null);
  const mundoRef = useRef<HTMLImageElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const anguloRef = useRef(0);
  /**
   * Arrasto fica em REF, não em estado: ele muda a cada `pointermove` (~100×/s)
   * e passar isso por `setState` repintaria a janela inteira a cada pixel de
   * mouse — a mesma razão pela qual o giro do retrato no Status é aplicado por
   * quadro (ver `hud/CharacterPortrait`).
   */
  const panRef = useRef({ x: 0, y: 0 });
  const arrastoRef = useRef<{ x: number; y: number } | null>(null);
  const fechar = () => useHudStore.getState().closeWindow("map");

  const campo = { w: px(MAP_LAYOUT.field.w), h: px(MAP_LAYOUT.field.h) };
  const conteudo =
    aba === "atual" ? { w: map.size.width, h: map.size.height } : { w: WORLD_SIZE.w, h: WORLD_SIZE.h };
  const zoom = MAP_ZOOM[zoomIdx] ?? 1;

  const fonte = useMemo(() => (aba === "atual" ? canvasDeColisao(map) : null), [aba, map]);
  const mapping = useMemo(() => legacyMapping(map), [map]);

  // Trocar de aba troca o CONTEÚDO, e um arrasto medido no mapa-múndi não quer
  // dizer nada sobre o mapa do servidor: a vista recomeça inteira.
  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    setZoomIdx(0);
  }, [aba]);

  /** posiciona a pintura do mapa-múndi (a aba "atual" desenha no canvas) */
  const posicionarMundo = () => {
    const img = mundoRef.current;
    if (!img) return;
    const v = enquadrar(campo, WORLD_SIZE, zoom, panRef.current);
    img.style.left = `${v.ox}px`;
    img.style.top = `${v.oy}px`;
    img.style.width = `${WORLD_SIZE.w * v.escala}px`;
    img.style.height = `${WORLD_SIZE.h * v.escala}px`;
  };
  // `useLayoutEffect` porque a pintura nasce em 0,0 no tamanho nativo: num
  // `useEffect` o navegador chega a pintar um quadro com ela fora do lugar.
  useLayoutEffect(posicionarMundo, [aba, zoom, campo.w, campo.h]);

  /**
   * O mapa do servidor: colisão, entidades e a seta do personagem.
   *
   * O laço não depende do arrasto (que mora num ref), então mover o mouse não
   * remonta o `requestAnimationFrame` — só o próximo quadro lê a posição nova.
   */
  useEffect(() => {
    if (aba !== "atual") return;
    const c = canvasRef.current;
    if (!c || !fonte) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const { width, height } = map.size;
    const grid = gridFor(map);

    const loop = () => {
      const now = performance.now();
      const v = enquadrar(campo, { w: width, h: height }, zoom, panRef.current);
      const world = useWorldStore.getState();

      // onde está o personagem, em célula LOCAL — o mesmo desvio do minimapa:
      // com sessão manda o servidor, sem ela sobra a posição do boneco local.
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

      ctx.clearRect(0, 0, campo.w, campo.h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(fonte, 0, 0, width, height, v.ox, v.oy, width * v.escala, height * v.escala);

      // Grade, como a do mapa-múndi pintado — mas só quando ela é legível: com
      // o mapa inteiro à vista o passo cai para poucos pixels e o que apareceria
      // é uma malha cinza por cima da colisão, não uma referência.
      const passo = GRID_STEP * v.escala;
      if (passo >= GRID_MIN_PX) {
        ctx.strokeStyle = MAP_COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let col = 0; col <= width; col += GRID_STEP) {
          const x = Math.round(v.ox + col * v.escala) + 0.5;
          if (x < 0 || x > campo.w) continue;
          ctx.moveTo(x, Math.max(0, v.oy));
          ctx.lineTo(x, Math.min(campo.h, v.oy + height * v.escala));
        }
        for (let row = 0; row <= height; row += GRID_STEP) {
          const y = Math.round(v.oy + row * v.escala) + 0.5;
          if (y < 0 || y > campo.h) continue;
          ctx.moveTo(Math.max(0, v.ox), y);
          ctx.lineTo(Math.min(campo.w, v.ox + width * v.escala), y);
        }
        ctx.stroke();
      }

      /** célula local → pixel dentro do campo (y invertido, como a fonte) */
      const toPixel = (col: number, row: number) => ({
        x: v.ox + (col + 0.5) * v.escala,
        y: v.oy + (height - 0.5 - row) * v.escala,
      });

      if (mapping && world.selfGid) {
        const raio = Math.max(2.5, Math.min(6, v.escala * 1.6));
        for (const entity of Object.values(world.entities)) {
          const cell = interpolatedCell(entity, now);
          const local = serverToLocal(mapping, Math.round(cell.x), Math.round(cell.y));
          const p = toPixel(local.col, local.row);
          if (p.x < 0 || p.y < 0 || p.x > campo.w || p.y > campo.h) continue;
          ctx.fillStyle = entity.kind === "npc" ? MM_COLORS.npc : MM_COLORS.mob;
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, raio, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // A seta é um <img> FORA do canvas: o campo é espelhado em X (herança do
      // minimapa, e é o que faz a orientação bater com a da câmera) e ela sairia
      // invertida junto. O `campo.w - p.x` desfaz o espelho só para esta camada.
      const seta = setaRef.current;
      if (seta) {
        const p = toPixel(eu.col, eu.row);
        if (indo) {
          anguloRef.current = Math.atan2(-(indo.col - eu.col), indo.row - eu.row);
        }
        const dentro = p.x >= 0 && p.y >= 0 && p.x <= campo.w && p.y <= campo.h;
        seta.style.display = dentro ? "block" : "none";
        seta.style.left = `${campo.w - p.x}px`;
        seta.style.top = `${p.y}px`;
        seta.style.transform = `translate(-50%,-50%) rotate(${anguloRef.current}rad)`;
      }

      // A coordenada é escrita no DOM por ref: ela muda a cada passo do
      // personagem, e um `setState` aqui repintaria a janela 20×/s.
      const coord = coordRef.current;
      if (coord) {
        const server = mapping ? localToServer(mapping, eu.col, eu.row) : { x: eu.col, y: eu.row };
        coord.textContent = `${server.x}, ${server.y}`;
      }

    };

    return subscribeHudTick(loop, MAPA_FPS);
  }, [aba, map, mapping, fonte, playerPos, zoom, campo.w, campo.h]);

  /**
   * Roda do mouse = zoom, ancorado no PONTEIRO.
   *
   * Vai por `addEventListener` com `passive: false` porque o React registra
   * `wheel` como PASSIVO na raiz — num `onWheel` o `preventDefault` seria
   * ignorado e a página rolaria atrás da janela.
   */
  useEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ponteiro = { x: e.clientX - r.left, y: e.clientY - r.top };
      setZoomIdx((i) => {
        const proximo = Math.max(0, Math.min(MAP_ZOOM.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
        if (proximo === i) return i;
        panRef.current = panAoAproximar(
          campo,
          conteudo,
          { zoom: MAP_ZOOM[i] ?? 1, pan: panRef.current },
          MAP_ZOOM[proximo] ?? 1,
          ponteiro,
        );
        return proximo;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [campo.w, campo.h, conteudo.w, conteudo.h]);

  const trocarZoom = (delta: number) => {
    setZoomIdx((i) => {
      const proximo = Math.max(0, Math.min(MAP_ZOOM.length - 1, i + delta));
      if (proximo === i) return i;
      // sem ponteiro, o âncora é o centro do campo — é o que o jogador está olhando
      panRef.current = panAoAproximar(
        campo,
        conteudo,
        { zoom: MAP_ZOOM[i] ?? 1, pan: panRef.current },
        MAP_ZOOM[proximo] ?? 1,
        { x: campo.w / 2, y: campo.h / 2 },
      );
      return proximo;
    });
  };

  return (
    <div style={{ position: "relative", width: MAP_WIDTH, height: (MAP_WIDTH * MAP_PLATE.h) / MAP_PLATE.w }}>
      <div
        style={{
          position: "absolute",
          inset: px(6),
          borderRadius: px(8),
          background: MAP_COLORS.panel,
          pointerEvents: "none",
        }}
      />
      <ChatFrame escala={FRAME_ESCALA} />

      {/* placa de madeira: as duas pontas com folhagem em tamanho fixo e o miolo
          liso esticado — `border-image` com `fill`, o 9-slice das barras num
          eixo só (ver NAME_PLATE em ui/mapWindow) */}
      <div
        style={{
          ...caixa(MAP_LAYOUT.title),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 3,
          borderStyle: "solid",
          borderWidth: `0 ${px((MAP_LAYOUT.title.h * NAME_PLATE.cap) / NAME_PLATE.h)}px`,
          borderImageSource: `url(${MAP_ART.namePlate})`,
          borderImageSlice: `0 ${NAME_PLATE.cap} fill`,
          borderImageWidth: `0 ${px((MAP_LAYOUT.title.h * NAME_PLATE.cap) / NAME_PLATE.h)}px`,
          borderImageRepeat: "stretch",
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            font: `700 ${px(TYPE.section)}px ${FRAME_FONT}`,
            lineHeight: 1,
            color: MAP_COLORS.ink,
            textShadow: `0 1px 3px ${MAP_COLORS.shadow}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {aba === "atual" ? (map.name ?? map.id) : "Mapa-múndi"}
        </span>
      </div>

      <div style={{ ...caixa(MAP_LAYOUT.tabs), display: "flex", gap: px(4), zIndex: 3 }}>
        {MAP_TABS.map((t) => (
          <Aba key={t.key} label={t.label} ativa={aba === t.key} onClick={() => setAba(t.key)} />
        ))}
      </div>

      <CurvedBox
        border={px(CHROME.tabBorder)}
        background="rgba(26,23,16,0.72)"
        style={{ ...caixa(MAP_LAYOUT.coords), zIndex: 3 }}
        inner={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: px(6),
          overflow: "hidden",
        }}
        title="célula do servidor em que o personagem está"
      >
        <span style={{ font: `${px(TYPE.small)}px ${FRAME_FONT}`, lineHeight: 1, color: MAP_COLORS.inkDim }}>
          Posição
        </span>
        <span
          ref={coordRef}
          style={{
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 700,
            fontSize: px(TYPE.label),
            lineHeight: 1,
            color: MAP_COLORS.ink,
            textShadow: `0 1px 2px ${MAP_COLORS.shadow}`,
          }}
        >
          —
        </span>
      </CurvedBox>

      <CurvedBox
        border={px(CHROME.boxBorder)}
        background={MAP_COLORS.field}
        style={{ ...caixa(MAP_LAYOUT.field), zIndex: 1 }}
        inner={{ overflow: "hidden", borderRadius: px(CHROME.boxBorder * 0.66) }}
      >
        <div
          ref={campoRef}
          onPointerDown={(e) => {
            arrastoRef.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const de = arrastoRef.current;
            if (!de) return;
            // o campo é espelhado em X na aba do servidor: arrastar para a
            // direita tem de levar o mapa para a direita NA TELA, e sem o sinal
            // invertido ele iria para o lado contrário do gesto
            const sinal = aba === "atual" ? -1 : 1;
            panRef.current = {
              x: panRef.current.x + sinal * (e.clientX - de.x),
              y: panRef.current.y + (e.clientY - de.y),
            };
            arrastoRef.current = { x: e.clientX, y: e.clientY };
            if (aba === "mundo") posicionarMundo();
          }}
          onPointerUp={(e) => {
            arrastoRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            arrastoRef.current = null;
          }}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            cursor: zoom > 1 ? "grab" : "default",
            touchAction: "none",
          }}
        >
          {aba === "atual" ? (
            <>
              <canvas
                ref={canvasRef}
                width={campo.w}
                height={campo.h}
                style={{ position: "absolute", inset: 0, transform: "scaleX(-1)" }}
              />
              <img
                ref={setaRef}
                src={MM_ART.player}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  width: px(16),
                  height: px(20),
                  transformOrigin: "50% 50%",
                  pointerEvents: "none",
                }}
              />
            </>
          ) : (
            <img
              ref={mundoRef}
              src={MAP_ART.world}
              alt="mapa-múndi"
              draggable={false}
              style={{ position: "absolute", pointerEvents: "none" }}
            />
          )}
        </div>
      </CurvedBox>

      <BotaoZoom
        art={MM_ART.zoomOut}
        titulo="Afastar"
        desabilitado={zoomIdx === 0}
        onClick={() => trocarZoom(-1)}
        ordem={1}
      />
      <BotaoZoom
        art={MM_ART.zoomIn}
        titulo="Aproximar"
        desabilitado={zoomIdx === MAP_ZOOM.length - 1}
        onClick={() => trocarZoom(1)}
        ordem={0}
      />

      <div
        style={{
          ...caixa(MAP_LAYOUT.footer),
          display: "flex",
          alignItems: "center",
          gap: px(12),
          zIndex: 3,
          overflow: "hidden",
        }}
      >
        {aba === "atual" ? (
          <>
            <Chip cor={MM_COLORS.walkable} label="Chão" />
            <Chip cor={MM_COLORS.wall} label="Bloqueio" />
            <Chip cor={MM_COLORS.water} label="Água" />
            <Chip cor={MM_COLORS.cliff} label="Penhasco" />
            <Ponto cor={MM_COLORS.mob} label="Monstro" />
            <Ponto cor={MM_COLORS.npc} label="NPC" />
            <Dica>roda: zoom · arraste: mover</Dica>
          </>
        ) : (
          // O mapa-múndi é ILUSTRAÇÃO: não existe tabela ligando os mapas do
          // rAthena às terras pintadas, então não há marcador de posição aqui.
          <Dica>
            O mapa-múndi é ilustração: ainda não há vínculo entre os mapas do servidor e as terras
            pintadas, então ele não marca onde você está.
          </Dica>
        )}
      </div>

      <Aro rect={MAP_LAYOUT.close} onClick={fechar} titulo="Fechar (Alt+M)" tinta={MAP_COLORS.closeTint}>
        <img src={CHAT_ART.closeTab} alt="x" draggable={false} style={{ width: "40%", height: "40%", display: "block" }} />
      </Aro>
    </div>
  );
}

/** aba: a moldura curva das barras tingida — a mesma receita da Lista de Amigos */
function Aba({ label, ativa, onClick }: { label: string; ativa: boolean; onClick: () => void }) {
  return (
    <CurvedBox
      border={px(CHROME.tabBorder)}
      background={ativa ? MAP_COLORS.tabActive : MAP_COLORS.tabIdle}
      style={{
        flex: 1,
        cursor: "pointer",
        filter: ativa ? "brightness(1.12)" : undefined,
        transition: "filter 120ms ease-out",
      }}
      inner={{ display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
      onPointerDown={onClick}
      title={label}
    >
      <span
        style={{
          font: `700 ${px(TYPE.tab)}px ${FRAME_FONT}`,
          lineHeight: 1,
          color: MAP_COLORS.ink,
          textShadow: `0 1px 2px ${MAP_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </CurvedBox>
  );
}

/** botão de zoom, flutuando no canto inferior-direito do campo */
function BotaoZoom({
  art,
  titulo,
  desabilitado,
  onClick,
  ordem,
}: {
  art: string;
  titulo: string;
  desabilitado: boolean;
  onClick: () => void;
  /** 0 = o mais à direita */
  ordem: number;
}) {
  const [hover, setHover] = useState(false);
  const d = px(MAP_LAYOUT.zoom.d);
  const m = px(MAP_LAYOUT.zoom.margin);
  const f = MAP_LAYOUT.field;

  return (
    <button
      onClick={onClick}
      title={titulo}
      disabled={desabilitado}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(f.x + f.w) - m - d * (ordem + 1) - px(4) * ordem,
        top: px(f.y + f.h) - m - d,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        lineHeight: 0,
        zIndex: 3,
        cursor: desabilitado ? "default" : "pointer",
        // desabilitado ainda tem de SER LIDO como botão: em 0,4 sobre o
        // mapa-múndi pintado (que tem uma rosa dos ventos clara bem onde ele
        // fica) o "−" simplesmente sumia, e some com ele a única pista de que
        // dá para afastar
        opacity: desabilitado ? 0.62 : 1,
        transform: hover && !desabilitado ? "scale(1.1)" : "scale(1)",
        filter: hover && !desabilitado ? "brightness(1.15)" : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out, opacity 110ms ease-out",
      }}
    >
      {/* disco escuro por baixo: o botão flutua sobre conteúdo de qualquer cor
          (campo verde na aba do servidor, pintura clara no mapa-múndi), e sem
          ele o contraste depende do que estiver embaixo */}
      <span
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "50%",
          background: "rgba(18,12,5,0.62)",
          boxShadow: "0 1px 4px rgba(12,8,3,0.7)",
        }}
      />
      <img
        src={art}
        alt=""
        draggable={false}
        style={{ position: "relative", width: "100%", height: "100%", display: "block" }}
      />
    </button>
  );
}

/** quadradinho da legenda, com a MESMA cor que o canvas pinta a célula */
function Chip({ cor, label }: { cor: readonly [number, number, number]; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: px(4), flex: "none" }}>
      <span
        style={{
          width: px(9),
          height: px(9),
          borderRadius: px(2),
          background: `rgb(${cor[0]},${cor[1]},${cor[2]})`,
          boxShadow: "inset 0 0 0 1px rgba(20,12,4,0.55)",
        }}
      />
      <Rotulo>{label}</Rotulo>
    </span>
  );
}

function Ponto({ cor, label }: { cor: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: px(4), flex: "none" }}>
      <span
        style={{
          width: px(8),
          height: px(8),
          borderRadius: "50%",
          background: cor,
          boxShadow: "inset 0 0 0 1px rgba(20,12,4,0.7)",
        }}
      />
      <Rotulo>{label}</Rotulo>
    </span>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        font: `${px(TYPE.small)}px ${FRAME_FONT}`,
        lineHeight: 1,
        color: MAP_COLORS.inkDim,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Dica({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        marginLeft: "auto",
        font: `${px(TYPE.small)}px ${FRAME_FONT}`,
        lineHeight: 1.3,
        color: MAP_COLORS.inkDim,
        textAlign: "right",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Aro de madeira do canto — o mesmo `ring-level` da placa do personagem, e a
 * mesma regra: o disco do miolo SOBRA 8% para dentro, porque o vazado do PNG é
 * levemente ovalado e um disco justo deixa um fio do jogo aparecendo por trás.
 */
function Aro({
  rect,
  children,
  onClick,
  titulo,
  tinta,
}: {
  rect: { cx: number; cy: number; d: number };
  children: React.ReactNode;
  onClick?: () => void;
  titulo?: string;
  tinta?: string;
}) {
  const [hover, setHover] = useState(false);
  const d = px(rect.d);
  return (
    <button
      onClick={onClick}
      title={titulo}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(rect.cx) - d / 2,
        top: px(rect.cy) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        zIndex: 4,
        cursor: onClick ? "pointer" : "default",
        transform: hover && onClick ? "scale(1.08)" : "none",
        transition: "transform 120ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "8%",
          borderRadius: "50%",
          background: tinta
            ? `radial-gradient(circle at 50% 30%, ${tinta}, #4d160f)`
            : "radial-gradient(circle at 50% 30%, #4a3a20, #2a1f10)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        {children}
      </div>
      <img
        src={CHAR_FRAME.ring}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </button>
  );
}
