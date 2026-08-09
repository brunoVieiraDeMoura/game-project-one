import { useEffect } from "react";
import { usePlayerStore } from "../net/playerStore";
import { useItemCatalog } from "../net/itemCatalog";
import { useCardStore } from "../net/cardStore";
import { CurvedBox } from "../ui/CurvedBox";
import { IconSquare } from "../ui/rpg";
import { FRAME_FONT } from "../ui/charFrame";
import { CHROME, TYPE, WINDOW_SCALE } from "../ui/windowChrome";
import { BOOK } from "../ui/travelbook";

const px = (v: number) => v * WINDOW_SCALE;
const LARGURA = 260;

/**
 * Escolha do equipamento pra compor uma carta — abre no DUPLO CLIQUE de uma
 * carta no inventário (`hud/InventoryWindow`).
 *
 * Dois passos, os dois do rAthena de verdade (clif.cpp:7070-7142): a lista de
 * quem aceita a carta vem do SERVIDOR (`net/cardStore.abrir` → `card:list`),
 * nunca é calculada aqui — o cliente não tem as mesmas regras de
 * compatibilidade que `clif_use_card` aplica (classe de equipamento,
 * identificado, slot livre, carta de escudo x mão esquerda, acessório
 * específico…). Escolher um item da lista manda a composição de verdade
 * (`card:insert`); o resultado FECHA o diálogo em sucesso e mostra erro em
 * falha, sem adivinhar nada — as duas coisas só o servidor sabe.
 */
export function CardApplyDialog() {
  const cardIndex = useCardStore((s) => s.cardIndex);
  const estado = useCardStore((s) => s.estado);
  const equipIndexes = useCardStore((s) => s.equipIndexes);
  const fechar = useCardStore((s) => s.fechar);
  const escolher = useCardStore((s) => s.escolher);

  const inventory = usePlayerStore((s) => s.inventory);
  const nomes = useItemCatalog((s) => s.byId);
  const carta = cardIndex != null ? inventory.find((i) => i.index === cardIndex) : undefined;
  const opcoes = equipIndexes.map((idx) => inventory.find((i) => i.index === idx)).filter((i) => i != null);

  useEffect(() => {
    const ids = opcoes.map((i) => i.itemId);
    if (carta) ids.push(carta.itemId);
    if (ids.length) useItemCatalog.getState().ensure(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipIndexes, carta?.itemId]);

  // a carta saiu do inventário (aplicada, jogada fora) enquanto o diálogo
  // esperava — fechar em vez de continuar mostrando um pedido fantasma
  useEffect(() => {
    if (cardIndex != null && !carta) fechar();
  }, [cardIndex, carta, fechar]);

  useEffect(() => {
    if (cardIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        fechar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cardIndex, fechar]);

  if (cardIndex == null || !carta) return null;

  const nomeCarta = nomes[carta.itemId]?.name ?? `#${carta.itemId}`;

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
        style={{ width: px(LARGURA), maxHeight: px(280) }}
        inner={{ display: "flex", flexDirection: "column", padding: px(12) }}
      >
        <div
          style={{
            font: `700 ${px(TYPE.section)}px ${FRAME_FONT}`,
            color: BOOK.parchmentLight,
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            textAlign: "center",
            marginBottom: px(4),
          }}
        >
          Colocar carta
        </div>
        <div
          style={{
            font: `${px(TYPE.small)}px ${FRAME_FONT}`,
            color: BOOK.gold,
            textAlign: "center",
            marginBottom: px(10),
          }}
        >
          {nomeCarta}
        </div>

        {estado === "esperando" && <Mensagem texto="Consultando equipamentos…" />}
        {estado === "vazio" && <Mensagem texto="Nenhum equipamento compatível no inventário." />}
        {estado === "falhou" && <Mensagem texto="Não foi possível compor — tente outro item." cor="#d9695f" />}

        {(estado === "pronto" || estado === "aplicando" || estado === "falhou") && opcoes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: px(4), overflowY: "auto" }}>
            {opcoes.map((item) => (
              <LinhaEquip
                key={item.index}
                nome={nomes[item.itemId]?.name ?? `#${item.itemId}`}
                itemId={item.itemId}
                refine={item.refine}
                cartasUsadas={item.cards.filter((c) => c > 0).length}
                slots={item.cards.length}
                desabilitado={estado === "aplicando"}
                onClick={() => escolher(item.index)}
              />
            ))}
          </div>
        )}

        <div style={{ marginTop: px(10), display: "flex", justifyContent: "center" }}>
          <button
            onClick={fechar}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.08)",
              borderRadius: px(4),
              color: BOOK.parchmentLight,
              font: `${px(TYPE.small)}px ${FRAME_FONT}`,
              padding: `${px(4)}px ${px(14)}px`,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </div>
      </CurvedBox>
    </div>
  );
}

function Mensagem({ texto, cor }: { texto: string; cor?: string }) {
  return (
    <div
      style={{
        font: `${px(TYPE.small)}px ${FRAME_FONT}`,
        color: cor ?? BOOK.parchmentLight,
        opacity: cor ? 1 : 0.75,
        textAlign: "center",
        padding: `${px(10)}px 0`,
      }}
    >
      {texto}
    </div>
  );
}

function LinhaEquip({
  nome,
  itemId,
  refine,
  cartasUsadas,
  slots,
  desabilitado,
  onClick,
}: {
  nome: string;
  itemId: number;
  refine: number;
  cartasUsadas: number;
  slots: number;
  desabilitado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={desabilitado}
      style={{
        display: "flex",
        alignItems: "center",
        gap: px(8),
        border: "none",
        background: "rgba(255,255,255,0.06)",
        borderRadius: px(4),
        padding: px(6),
        cursor: desabilitado ? "default" : "pointer",
        opacity: desabilitado ? 0.5 : 1,
        textAlign: "left",
      }}
    >
      <div style={{ width: px(26), height: px(26), flex: "none" }}>
        <IconSquare seed={`item-${itemId}`} size={px(26)} />
      </div>
      <span
        style={{
          flex: 1,
          font: `${px(TYPE.small)}px ${FRAME_FONT}`,
          color: BOOK.parchmentLight,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nome}
        {refine > 0 ? ` +${refine}` : ""}
      </span>
      <span style={{ font: `${px(TYPE.small)}px ${FRAME_FONT}`, color: BOOK.gold, flex: "none" }}>
        {cartasUsadas}/{slots}
      </span>
    </button>
  );
}
