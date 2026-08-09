import { useEffect, useRef } from "react";
import { usePlayerStore } from "../net/playerStore";
import { useItemCatalog, type ItemInfo } from "../net/itemCatalog";
import { useItemInfoStore } from "../net/itemInfoStore";
import { CurvedBox } from "../ui/CurvedBox";
import { IconSquare } from "../ui/rpg";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHROME, TYPE, WINDOW_SCALE } from "../ui/windowChrome";
import { BOOK } from "../ui/travelbook";
import { ChatScrollbar } from "./ChatScrollbar";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import { itemGenderLabel, itemLocationLabel, itemSubTypeLabel, itemTypeLabel } from "../ui/itemLabels";

const px = (v: number) => v * WINDOW_SCALE;
const LARGURA = 340;
const ICONE = 56;

/**
 * Informação do item — abre no BOTÃO DIREITO de um slot do inventário.
 *
 * Antes o botão direito jogava o item no chão na hora, sem confirmação (o
 * arraste pro mundo, `net/worldDropStore`, é quem faz isso agora). Aqui é só
 * leitura: NUNCA dispara `item:drop`, `item:use` ou qualquer pedido ao
 * servidor — mostrar informação não pode ter efeito colateral nenhum.
 *
 * Layout 1fr/2fr, como o pedido: coluna estreita com o que se vê num
 * relance (ícone, nome, tipo, peso, preço); coluna larga com o que precisa
 * de leitura (requisito, atributos, efeito), rolável quando não cabe.
 */
export function ItemInfoWindow() {
  const index = useItemInfoStore((s) => s.index);
  const fechar = useItemInfoStore((s) => s.fechar);
  const item = usePlayerStore((s) => (index != null ? s.inventory.find((i) => i.index === index) : undefined));
  const info = useItemCatalog((s) => (item ? s.byId[item.itemId] : undefined));

  useEffect(() => {
    if (item) useItemCatalog.getState().ensure([item.itemId]);
  }, [item]);

  // o item saiu do inventário (usado, trocado de lugar) enquanto a janela
  // estava aberta — fechar em vez de continuar mostrando um slot fantasma
  useEffect(() => {
    if (index != null && !item) fechar();
  }, [index, item, fechar]);

  // Esc fecha só ESTA janela — mesmo padrão de `hud/WorldDropDialog`:
  // captura, não bolha, então `stopPropagation` chega ANTES do atalho global
  // de janelas (`hud/hotkeys.ts`, na bolha) e evita fechar as duas no mesmo aperto
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        fechar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [item, fechar]);

  if (!item) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10,7,4,0.45)",
        zIndex: 1000,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
    >
      <CurvedBox
        border={px(CHROME.tabBorder)}
        background="rgba(24,18,10,0.96)"
        style={{ width: px(LARGURA), height: px(220) }}
        inner={{ display: "flex", flexDirection: "column", padding: px(12), height: "100%", boxSizing: "border-box" }}
      >
        <Cabecalho nome={info?.name ?? `#${item.itemId}`} refine={item.refine} onFechar={fechar} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: px(10),
            flex: 1,
            minHeight: 0,
            marginTop: px(8),
          }}
        >
          <ColunaEsquerda item={item} info={info} />
          <ColunaDireita item={item} info={info} />
        </div>
      </CurvedBox>
    </div>
  );
}

function Cabecalho({ nome, refine, onFechar }: { nome: string; refine: number; onFechar: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: px(8) }}>
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(TYPE.section),
          color: BOOK.parchmentLight,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nome}
        {refine > 0 ? ` +${refine}` : ""}
      </span>
      <button
        onClick={onFechar}
        title="Fechar (Esc)"
        style={{
          border: "none",
          background: "rgba(255,255,255,0.08)",
          borderRadius: px(4),
          color: BOOK.parchmentLight,
          width: px(18),
          height: px(18),
          lineHeight: 1,
          cursor: "pointer",
          flex: "none",
        }}
      >
        ✕
      </button>
    </div>
  );
}

function ColunaEsquerda({ item, info }: { item: { itemId: number; amount: number }; info?: ItemInfo }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: px(6) }}>
      <div style={{ width: px(ICONE), height: px(ICONE), flex: "none" }}>
        <IconSquare seed={`item-${item.itemId}`} size={px(ICONE)} />
      </div>
      {info && (
        <>
          <Rotulo texto={itemTypeLabel(info.type)} />
          {itemSubTypeLabel(info.subType) && <Rotulo texto={itemSubTypeLabel(info.subType)!} sutil />}
          <div style={{ height: px(4) }} />
          <Linha rotulo="Peso" valor={(info.weight / 10).toFixed(1)} />
          <Linha rotulo="Compra" valor={info.buyPrice.toLocaleString("pt-BR")} />
          <Linha rotulo="Venda" valor={info.sellPrice.toLocaleString("pt-BR")} />
          {item.amount > 1 && <Linha rotulo="Quantidade" valor={String(item.amount)} />}
        </>
      )}
    </div>
  );
}

function ColunaDireita({ item, info }: { item: { refine: number; cards: number[] }; info?: ItemInfo }) {
  const rolavel = useRef<HTMLDivElement>(null);
  if (!info) {
    return (
      <div style={{ font: `${px(TYPE.small)}px ${FRAME_FONT}`, color: BOOK.parchmentLight, opacity: 0.6 }}>
        carregando…
      </div>
    );
  }

  const linhas = descrever(info, item);

  return (
    <div style={{ position: "relative", minHeight: 0, display: "flex" }}>
      <ScrollbarHider />
      <div
        ref={rolavel}
        className="chat-scroll"
        style={{ flex: 1, minWidth: 0, overflowY: "auto", paddingRight: px(6) }}
      >
        {linhas.map((linha, i) => (
          <div
            key={i}
            style={{
              font: `${px(TYPE.small)}px ${FRAME_FONT}`,
              color: BOOK.parchmentLight,
              lineHeight: 1.5,
              marginBottom: px(4),
            }}
          >
            {linha}
          </div>
        ))}
        {info.rawScript && (
          <div
            style={{
              marginTop: px(8),
              padding: px(6),
              background: "rgba(0,0,0,0.3)",
              borderRadius: px(4),
              font: `${px(TYPE.small) - 1}px monospace`,
              color: BOOK.gold,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {info.rawScript}
          </div>
        )}
      </div>
      <ChatScrollbar alvo={rolavel} revisao={linhas.length} largura={px(10)} auto />
    </div>
  );
}

/**
 * Composição frase-a-frase, como `SkillsWindow.descrever()`: cada oração
 * sai de UM campo do catálogo, nunca texto de sabor inventado.
 */
function descrever(info: ItemInfo, item: { refine: number; cards: number[] }): string[] {
  const linhas: string[] = [];

  if (info.equipLevelMin > 0 || info.equipLevelMax > 0) {
    if (info.equipLevelMax > 0) linhas.push(`Requer nível ${info.equipLevelMin || 1} a ${info.equipLevelMax}.`);
    else linhas.push(`Requer nível ${info.equipLevelMin}.`);
  }

  if (info.gender !== "both") linhas.push(`Restrito a personagens do sexo ${itemGenderLabel(info.gender).toLowerCase()}.`);

  if (info.locations.length > 0) {
    linhas.push(`Local: ${info.locations.map(itemLocationLabel).join(", ")}.`);
  }

  if (info.attack > 0) linhas.push(`Ataque: ${info.attack}.`);
  if (info.magicAttack > 0) linhas.push(`Ataque Mágico: ${info.magicAttack}.`);
  if (info.defense > 0) linhas.push(`Defesa: ${info.defense}.`);
  if (info.range > 0) linhas.push(`Alcance: ${info.range} células.`);
  if (info.slots > 0) {
    const usados = item.cards.filter((c) => c > 0).length;
    linhas.push(`Slots de carta: ${usados} / ${info.slots} usados.`);
  }
  if (item.refine > 0) linhas.push(`Refinado: +${item.refine}.`);

  if (linhas.length === 0) linhas.push("Sem requisitos ou atributos especiais.");
  return linhas;
}

function Rotulo({ texto, sutil }: { texto: string; sutil?: boolean }) {
  return (
    <span
      style={{
        font: `700 ${px(TYPE.small)}px ${FRAME_FONT}`,
        color: sutil ? BOOK.parchmentLight : BOOK.gold,
        opacity: sutil ? 0.7 : 1,
        textAlign: "center",
      }}
    >
      {texto}
    </span>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: px(4) }}>
      <span style={{ font: `${px(TYPE.small)}px ${FRAME_FONT}`, color: BOOK.parchmentLight, opacity: 0.8 }}>
        {rotulo}
      </span>
      <span
        style={{
          font: `700 ${px(TYPE.small)}px ${FRAME_NUM_FONT}`,
          fontVariantNumeric: FRAME_NUM_VARIANT,
          color: BOOK.parchmentLight,
        }}
      >
        {valor}
      </span>
    </div>
  );
}
