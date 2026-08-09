import { useEffect, useState } from "react";
import { usePlayerStore } from "../net/playerStore";
import { useItemCatalog } from "../net/itemCatalog";
import { useWorldDropStore } from "../net/worldDropStore";
import { gateway } from "../net/gateway";
import { CurvedBox } from "../ui/CurvedBox";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { CHROME, TYPE, WINDOW_SCALE } from "../ui/windowChrome";
import { BOOK } from "../ui/travelbook";

const px = (v: number) => v * WINDOW_SCALE;

/**
 * Confirmação de "jogar item no chão" — abre quando o arraste do inventário
 * solta em cima do mundo 3D (`play/WorldDropZone`).
 *
 * Item empilhável pede QUANTO jogar; item único (amount 1) só confirma — o
 * seletor não tem o que escolher e só atrapalharia. Fecha sozinho se o item
 * sumir do inventário enquanto o diálogo está aberto (usado, trocado de
 * lugar, o slot mudou) — confirmar contra um índice que não existe mais
 * jogaria o item ERRADO no chão.
 */
export function WorldDropDialog() {
  const index = useWorldDropStore((s) => s.index);
  const fechar = useWorldDropStore((s) => s.fechar);
  const item = usePlayerStore((s) => (index != null ? s.inventory.find((i) => i.index === index) : undefined));
  const nomes = useItemCatalog((s) => s.byId);

  useEffect(() => {
    if (item) useItemCatalog.getState().ensure([item.itemId]);
  }, [item]);

  // o item saiu do inventário (usado/equipado/vendido) enquanto o diálogo
  // esperava resposta — fechar em vez de confirmar contra um slot fantasma
  useEffect(() => {
    if (index != null && !item) fechar();
  }, [index, item, fechar]);

  // começa em 1, não no total: um arraste sem querer não pode esvaziar o
  // stack inteiro — quem quer jogar tudo aperta "Tudo"
  const [quantidade, setQuantidade] = useState(1);
  useEffect(() => {
    setQuantidade(1);
  }, [item?.index]);

  if (!item) return null;

  const nome = nomes[item.itemId]?.name ?? `#${item.itemId}`;
  const quantidadeValida = Math.min(quantidade, item.amount);
  const confirmar = () => {
    gateway().emit("item:drop", { index: item.index, amount: quantidadeValida });
    fechar();
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10,7,4,0.45)",
        // acima de QUALQUER janela: `Windows.tsx` empilha em 100 + índice (no
        // máximo 6 janelas hoje, teto ~106) — 1000 sobra folga sem depender de
        // contar quantas estão abertas.
        zIndex: 1000,
      }}
      // clicar fora cancela, como qualquer confirmação — sem isso o único jeito
      // de sair seria acertar o botão Cancelar num overlay que cobre a tela toda
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
    >
      <CurvedBox border={px(CHROME.tabBorder)} background="rgba(24,18,10,0.96)" style={{ width: px(220) }} inner={{ padding: px(14) }}>
        <div
          style={{
            fontFamily: FRAME_FONT,
            fontWeight: 700,
            fontSize: px(TYPE.section),
            color: BOOK.parchmentLight,
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            textAlign: "center",
            marginBottom: px(10),
          }}
        >
          Jogar no chão
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: px(6),
            marginBottom: px(12),
          }}
        >
          <span
            style={{
              fontFamily: FRAME_FONT,
              fontSize: px(TYPE.label),
              color: BOOK.gold,
              textShadow: "0 1px 2px rgba(0,0,0,0.8)",
              textAlign: "center",
            }}
          >
            {nome}
          </span>
        </div>

        {item.amount > 1 && (
          <div style={{ marginBottom: px(12) }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: px(4),
              }}
            >
              <span
                style={{
                  fontFamily: FRAME_FONT,
                  fontSize: px(TYPE.small),
                  color: BOOK.parchmentLight,
                  opacity: 0.85,
                }}
              >
                Quantidade
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: px(3) }}>
                <input
                  type="number"
                  min={1}
                  max={item.amount}
                  value={Math.min(quantidade, item.amount)}
                  onChange={(e) => {
                    const v = Math.trunc(Number(e.target.value));
                    // campo livre enquanto digita (apagar tudo não pode virar
                    // 0/NaN e travar) — só entra no lugar quando é um número
                    // válido de verdade
                    if (Number.isFinite(v)) setQuantidade(Math.min(Math.max(1, v), item.amount));
                  }}
                  style={{
                    width: px(38),
                    font: `700 ${px(TYPE.label)}px ${FRAME_NUM_FONT}`,
                    fontVariantNumeric: FRAME_NUM_VARIANT,
                    color: BOOK.parchmentLight,
                    background: "rgba(0,0,0,0.35)",
                    border: `1px solid ${BOOK.gold}55`,
                    borderRadius: px(3),
                    padding: `0 ${px(3)}px`,
                    textAlign: "right",
                  }}
                />
                <span
                  style={{
                    fontFamily: FRAME_NUM_FONT,
                    fontVariantNumeric: FRAME_NUM_VARIANT,
                    fontWeight: 700,
                    fontSize: px(TYPE.label),
                    color: BOOK.parchmentLight,
                  }}
                >
                  / {item.amount}
                </span>
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={item.amount}
              // clampado: o stack pode encolher (item usado noutra janela)
              // enquanto o diálogo está aberto, e `value` acima de `max` o
              // navegador aceita mas o slider some visualmente
              value={Math.min(quantidade, item.amount)}
              onChange={(e) => setQuantidade(Number(e.target.value))}
              style={{ width: "100%", accentColor: BOOK.gold }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", gap: px(6), marginTop: px(6) }}>
              <QtdBotao rotulo="1" onClick={() => setQuantidade(1)} />
              <QtdBotao rotulo="Metade" onClick={() => setQuantidade(Math.max(1, Math.ceil(item.amount / 2)))} />
              <QtdBotao rotulo="Tudo" onClick={() => setQuantidade(item.amount)} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: px(6) }}>
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao onClick={confirmar} destaque>
            Jogar {item.amount > 1 ? `×${quantidadeValida}` : ""}
          </Botao>
        </div>
      </CurvedBox>
    </div>
  );
}

function QtdBotao({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        border: "none",
        background: "rgba(255,255,255,0.08)",
        borderRadius: px(4),
        color: BOOK.parchmentLight,
        fontFamily: FRAME_FONT,
        fontSize: px(TYPE.small),
        padding: `${px(3)}px 0`,
        cursor: "pointer",
      }}
    >
      {rotulo}
    </button>
  );
}

function Botao({
  children,
  onClick,
  destaque,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destaque?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <CurvedBox
      border={px(6)}
      background={destaque ? "#4a7a3c" : "#5a4636"}
      style={{
        flex: 1,
        height: px(24),
        cursor: "pointer",
        filter: hover ? "brightness(1.15)" : undefined,
        transition: "filter 110ms ease-out",
      }}
      inner={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={onClick}
    >
      <span
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(TYPE.small),
          color: BOOK.parchmentLight,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </CurvedBox>
  );
}
