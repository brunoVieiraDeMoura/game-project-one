import { useState } from "react";
import { usePlayerStore } from "../net/playerStore";
import { gateway } from "../net/gateway";
import { useHudStore } from "./hudStore";
import { IconSquare } from "../ui/rpg";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { useNineSlice } from "../ui/nineSlice";
import { SLOT_FRAME } from "../ui/skillBar";
import {
  BAG_ART,
  BAG_COLORS,
  BAG_CONTENT,
  BAG_GRID,
  BAG_LAYOUT,
  BAG_PLATE,
  BAG_TABS,
  BAG_WIDTH,
  type BagTab,
} from "../ui/bag";

const escala = BAG_WIDTH / BAG_PLATE.w;
const px = (v: number) => v * escala;
const caixa = (r: { x: number; y: number; w: number; h: number }) => ({
  position: "absolute" as const,
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});

/**
 * Categorias do inventário do RO por `type` do item_db
 * (rathena/src/map/itemdb.hpp, enum item_types): 0 healing, 2 usable, 11 delay
 * consume, 18 cash → consumível; 4 armor, 5 weapon, 8 ammo → equipamento; o
 * resto (3 etc, 6 card, 7 pet egg, 10 pet armor) cai em Outros.
 */
const CONSUMABLE_TYPES = new Set([0, 2, 11, 18]);
const EQUIP_TYPES = new Set([4, 5, 8]);

/**
 * Inventário vestido com a arte de `ui_definitiva/bag`.
 *
 * A janela traz a própria moldura, o próprio título e o próprio botão de
 * fechar, então ela NÃO entra no `Panel` genérico de `Windows.tsx` — quem abre
 * desvia para cá.
 *
 * O peso e o ouro vêm do servidor (`playerStore`): o rAthena manda peso, peso
 * máximo e zeny em PAR_CHANGE. "Ouro" é só o nome que o projeto dá ao zeny.
 */
export function InventoryWindow() {
  const [cat, setCat] = useState<BagTab>("consumiveis");
  const online = usePlayerStore((s) => s.known);
  const inventory = usePlayerStore((s) => s.inventory);
  const stats = usePlayerStore((s) => s.stats);
  const fechar = () => useHudStore.getState().setWindow(null);

  const items = inventory.filter((it) =>
    cat === "consumiveis"
      ? CONSUMABLE_TYPES.has(it.type)
      : cat === "equipamentos"
        ? EQUIP_TYPES.has(it.type)
        : !CONSUMABLE_TYPES.has(it.type) && !EQUIP_TYPES.has(it.type),
  );

  // Consumível: usa. Equipamento: veste/tira. O servidor responde com o
  // inv:remove / a lista nova — nada muda na tela por conta própria.
  const usar = (item: (typeof inventory)[number]) => {
    if (EQUIP_TYPES.has(item.type)) {
      gateway().emit(item.equipped ? "item:unequip" : "item:equip", { index: item.index });
      return;
    }
    if (CONSUMABLE_TYPES.has(item.type)) gateway().emit("item:use", { index: item.index });
  };

  const total = BAG_GRID.cols * BAG_GRID.rows;
  const gap = px(BAG_GRID.gap);
  // O lado do slot SAI da grade, não de um número da arte: o ícone e a
  // quantidade se medem por ele. Com tamanho fixo, o ícone ficava maior que o
  // miolo do slot e vazava por cima da moldura.
  const slotPx = (px(BAG_LAYOUT.grid.w) - gap * (BAG_GRID.cols - 1)) / BAG_GRID.cols;

  return (
    <div style={{ position: "relative", width: BAG_WIDTH, height: (BAG_WIDTH * BAG_PLATE.h) / BAG_PLATE.w }}>
      <img
        src={BAG_ART.plate}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />

      <div
        style={{
          ...caixa(BAG_LAYOUT.title),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(19),
          lineHeight: 1,
          color: BAG_COLORS.ink,
          textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
          pointerEvents: "none",
        }}
      >
        Inventário
      </div>

      <div style={{ ...caixa(BAG_LAYOUT.tabs), display: "flex", gap: px(4) }}>
        {BAG_TABS.map((t) => (
          <Aba key={t.key} label={t.label} cor={t.cor} ativa={cat === t.key} onClick={() => setCat(t.key)} />
        ))}
      </div>

      <div
        style={{
          ...caixa(BAG_LAYOUT.grid),
          display: "grid",
          gridTemplateColumns: `repeat(${BAG_GRID.cols}, 1fr)`,
          gridTemplateRows: `repeat(${BAG_GRID.rows}, 1fr)`,
          gap,
        }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const it = items[i];
          return (
            <Slot
              key={it ? it.index : `vazio-${i}`}
              rotulo={it ? String(it.itemId) : undefined}
              quantidade={it && it.amount > 1 ? it.amount : undefined}
              equipado={it?.equipped}
              titulo={
                it
                  ? `#${it.itemId}${it.refine ? ` +${it.refine}` : ""}${it.equipped ? " (equipado)" : ""} — clique usa/equipa, botão direito joga no chão`
                  : undefined
              }
              onClick={it ? () => usar(it) : undefined}
              onDrop={
                it
                  ? () => gateway().emit("item:drop", { index: it.index, amount: 1 })
                  : undefined
              }
              indice={it?.index}
              lado={slotPx}
            />
          );
        })}
      </div>

      <Contador
        rect={BAG_LAYOUT.weight}
        icone={BAG_ART.weight}
        rotulo="Peso"
        // sem casa decimal: o rAthena manda o peso em DÉCIMOS, e "112.1 /
        // 311.0" não cabe no contador — o inteiro é o que o jogador usa
        valor={`${Math.round(stats.weight / 10)} / ${Math.round(stats.maxWeight / 10)}`}
      />
      <Contador
        rect={BAG_LAYOUT.gold}
        icone={BAG_ART.coin}
        rotulo="Ouro"
        valor={stats.zeny.toLocaleString("pt-BR")}
      />

      <BotaoFechar onClick={fechar} />

      {!online && (
        <div
          style={{
            position: "absolute",
            left: px(BAG_CONTENT.x),
            right: px(BAG_CONTENT.x),
            top: px(150),
            textAlign: "center",
            font: `12px ${FRAME_FONT}`,
            color: BAG_COLORS.inkDim,
            textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          Sem sessão: o inventário só existe com o personagem logado no rAthena.
        </div>
      )}
    </div>
  );
}

/** aba de categoria: moldura curva das barras, tingida da cor do grupo */
function Aba({
  label,
  cor,
  ativa,
  onClick,
}: {
  label: string;
  cor: string;
  ativa: boolean;
  onClick: () => void;
}) {
  return (
    <CurvedBox
      border={px(7)}
      background={cor}
      style={{
        flex: 1,
        cursor: "pointer",
        opacity: ativa ? 1 : 0.66,
        filter: ativa ? "brightness(1.14)" : undefined,
        transition: "opacity 120ms ease-out, filter 120ms ease-out",
      }}
      inner={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        padding: `0 ${px(3)}px`,
      }}
      onPointerDown={onClick}
      title={label}
    >
      {/* branco em todas: quem diz a categoria é a cor do FUNDO. `ellipsis` é
          rede de segurança: "Equipamentos" é a palavra mais longa e, num
          idioma/fonte diferente, ela não pode empurrar a moldura. */}
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(9),
          lineHeight: 1,
          color: BAG_COLORS.ink,
          textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
    </CurvedBox>
  );
}

/**
 * Slot do inventário: a MESMA moldura dos slots de habilidade
 * (`square-skill`), montada pelo 9-slice genérico.
 */
function Slot({
  rotulo,
  quantidade,
  equipado,
  titulo,
  onClick,
  onDrop,
  indice,
  lado,
}: {
  rotulo?: string;
  quantidade?: number;
  equipado?: boolean;
  titulo?: string;
  onClick?: () => void;
  onDrop?: () => void;
  indice?: number;
  /** lado do slot em px de tela — moldura, ícone e número saem daqui */
  lado: number;
}) {
  const frame = useNineSlice(SLOT_FRAME);
  const [hover, setHover] = useState(false);
  const borda = Math.max(6, lado * 0.24);

  return (
    <div
      onClick={onClick}
      // Botão direito joga no chão, como no RO (lá é arrastar para fora da
      // janela; aqui o menu de contexto do navegador atrapalharia).
      onContextMenu={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      draggable={indice != null}
      onDragStart={(e) => indice != null && e.dataTransfer.setData("application/x-ro-item", String(indice))}
      title={titulo}
      style={{
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        transform: hover && onClick ? "translateY(-2px)" : "none",
        filter: hover && onClick ? "brightness(1.12)" : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: borda / 3,
          borderRadius: borda * 0.66,
          background: hover && onClick ? BAG_COLORS.slotHover : BAG_COLORS.slot,
          transition: "background 110ms ease-out",
        }}
      />
      {frame && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderStyle: "solid",
            borderWidth: borda,
            borderImageSource: `url(${frame})`,
            borderImageSlice: SLOT_FRAME.slice ?? 24,
            borderImageWidth: `${borda}px`,
            borderImageRepeat: "stretch",
            pointerEvents: "none",
          }}
        />
      )}
      {rotulo && (
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
          <IconSquare seed={`item-${rotulo}`} size={lado * 0.56} label={rotulo} />
        </div>
      )}
      {equipado && (
        <div
          style={{
            position: "absolute",
            inset: borda / 3,
            borderRadius: borda * 0.66,
            boxShadow: "inset 0 0 0 2px rgba(255,206,120,0.85)",
            pointerEvents: "none",
          }}
        />
      )}
      {quantidade != null && (
        <span
          style={{
            position: "absolute",
            right: borda * 0.5,
            bottom: borda * 0.3,
            fontFamily: FRAME_NUM_FONT,
            fontVariantNumeric: FRAME_NUM_VARIANT,
            fontWeight: 700,
            fontSize: Math.max(9, lado * 0.24),
            lineHeight: 1,
            color: BAG_COLORS.ink,
            textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
            pointerEvents: "none",
          }}
        >
          {quantidade}
        </span>
      )}
    </div>
  );
}

/** faixa de peso / ouro: ícone à esquerda, rótulo e valor dentro da moldura */
function Contador({
  rect,
  icone,
  rotulo,
  valor,
}: {
  rect: { x: number; y: number; w: number; h: number };
  icone: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <CurvedBox
      border={px(8)}
      background={BAG_COLORS.counter}
      style={caixa(rect)}
      inner={{ display: "flex", alignItems: "center", gap: px(4), padding: `0 ${px(6)}px`, overflow: "hidden" }}
    >
      <img
        src={icone}
        alt=""
        draggable={false}
        style={{ height: px(15), width: "auto", flex: "none", pointerEvents: "none" }}
      />
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(10),
          lineHeight: 1,
          color: BAG_COLORS.ink,
          textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
          flex: "none",
        }}
      >
        {rotulo}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: FRAME_NUM_FONT,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          fontSize: px(10),
          lineHeight: 1,
          color: BAG_COLORS.ink,
          textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
          whiteSpace: "nowrap",
        }}
      >
        {valor}
      </span>
    </CurvedBox>
  );
}

/** aro com o "x": o mesmo `ring-level` das outras telas, com o miolo vermelho */
function BotaoFechar({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const d = px(BAG_LAYOUT.close.d);
  return (
    <button
      onClick={onClick}
      title="Fechar (Alt+E)"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: px(BAG_LAYOUT.close.cx) - d / 2,
        top: px(BAG_LAYOUT.close.cy) - d / 2,
        width: d,
        height: d,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        transform: hover ? "scale(1.08)" : "none",
        transition: "transform 120ms ease-out",
      }}
    >
      {/* miolo FOLGADO, como nos aros de nível: o vazado do PNG é levemente
          ovalado e um disco justo deixa um fio de fundo aparecer */}
      <div
        style={{
          position: "absolute",
          inset: "8%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 30%, ${BAG_COLORS.closeTint}, #4d160f)`,
        }}
      />
      {/* o "x" centraliza por FLEX, não por `translate(-50%,-50%)`: com a
          translação o navegador arredonda meio pixel e o desenho ficava um
          fio fora do meio do aro */}
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
        <img
          src={CHAT_ART.closeTab}
          alt="x"
          draggable={false}
          style={{ width: "40%", height: "40%", display: "block" }}
        />
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
