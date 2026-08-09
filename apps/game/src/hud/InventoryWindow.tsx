import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../net/playerStore";
import { gateway } from "../net/gateway";
import { useItemCatalog } from "../net/itemCatalog";
import { equipPending, precheckEquip, requestEquip, requestUnequip } from "../net/equipmentStore";
import { useHudStore } from "./hudStore";
import { IconSquare } from "../ui/rpg";
import { CHAR_FRAME, FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { dragImagemNormal } from "../ui/cursors";
import { useItemInfoStore } from "../net/itemInfoStore";
import { useCardStore } from "../net/cardStore";
import { CHAT_ART } from "../ui/chatFrame";
import { CurvedBox } from "../ui/CurvedBox";
import { useNineSlice } from "../ui/nineSlice";
import { SLOT_FRAME } from "../ui/skillBar";
import { CHROME, TYPE } from "../ui/windowChrome";
import { ChatScrollbar } from "./ChatScrollbar";
import { ScrollbarHider } from "../ui/ScrollbarHider";
import {
  BAG_ART,
  BAG_COLORS,
  BAG_CONTENT,
  BAG_GRID,
  encurtarNome,
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
/** IT_CARD (rathena/src/common/mmo.hpp:230) — cai em Outros, duplo clique compõe */
const CARD_TYPE = 6;

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
  const fechar = () => useHudStore.getState().closeWindow("inventory");

  /**
   * Nome de verdade dos itens da bolsa.
   *
   * O pedido é pelo INVENTÁRIO INTEIRO, não pela aba visível: trocar de aba não
   * pode disparar rede, e o `ensure` só busca o que ainda falta — pedir tudo de
   * uma vez é uma requisição contra três.
   */
  const nomes = useItemCatalog((s) => s.byId);
  useEffect(() => {
    useItemCatalog.getState().ensure(inventory.map((it) => it.itemId));
  }, [inventory]);

  const items = inventory.filter((it) =>
    cat === "consumiveis"
      ? CONSUMABLE_TYPES.has(it.type)
      : cat === "equipamentos"
        ? EQUIP_TYPES.has(it.type)
        : !CONSUMABLE_TYPES.has(it.type) && !EQUIP_TYPES.has(it.type),
  );

  // Consumível: CLIQUE ÚNICO usa (padrão RO). Equipamento: DUPLO CLIQUE
  // veste/tira — clique único em equipamento não faz nada, senão um clique
  // errado troca a arma sem querer. O servidor responde com o inv:remove / a
  // lista nova — nada muda na tela por conta própria (ele que valida classe,
  // requisito e slot; o cliente só pede).
  const usar = (item: (typeof inventory)[number]) => {
    if (CONSUMABLE_TYPES.has(item.type)) gateway().emit("item:use", { index: item.index });
  };

  const equipar = (item: (typeof inventory)[number]) => {
    if (!EQUIP_TYPES.has(item.type)) return;
    // Duplo clique repetido enquanto o pedido anterior ainda não voltou não
    // manda um segundo `CZ.REQ_WEAR_EQUIP` — o slot fica preso até o ACK
    // (sucesso OU falha) chegar, nunca por um relógio do cliente.
    if (equipPending(item.index)) return;
    if (item.equipped) {
      requestUnequip(item.index);
      return;
    }
    // Checagem RASA: só nível, que é dado que já está na tela. Classe,
    // sexo e slot de carta continuam sendo o rAthena quem decide — isto é
    // só para não abrir um pedido que qualquer jogador já veria como bobo.
    const pre = precheckEquip(nomes[item.itemId], stats.baseLevel);
    if (!pre.ok) return;
    requestEquip(item.index);
  };

  const gap = px(BAG_GRID.gap);
  const barraW = px(BAG_GRID.barra);
  /** largura útil da grade: o vão da arte menos a coluna da barra de rolagem */
  const gradeW = px(BAG_LAYOUT.grid.w) - barraW - px(BAG_GRID.barraGap);
  // O lado do slot SAI da grade, não de um número da arte: o ícone e a
  // quantidade se medem por ele. Com tamanho fixo, o ícone ficava maior que o
  // miolo do slot e vazava por cima da moldura.
  const slotPx = (gradeW - gap * (BAG_GRID.cols - 1)) / BAG_GRID.cols;
  /**
   * Quantos slots DESENHAR.
   *
   * Enche a última fileira para a grade não terminar num degrau, e nunca mostra
   * menos que a janela cabe — assim uma bolsa quase vazia continua com a moldura
   * preenchida, como na referência.
   */
  const visiveis = BAG_GRID.cols * BAG_GRID.rows;
  const total = Math.max(visiveis, Math.ceil(items.length / BAG_GRID.cols) * BAG_GRID.cols);

  /**
   * A rolagem é a MESMA do chat (`hud/ChatScrollbar`).
   *
   * O navegador não veste a barra do sistema com imagem, então a nativa é
   * escondida (`.chat-scroll`, via `ui/ScrollbarHider`) e esta é desenhada por
   * cima. `auto` a faz sumir por LARGURA ZERO quando não há excedente —
   * desmontá-la seria pior, porque quem mede o excedente precisa do trilho no
   * DOM para descobrir que ela voltou a ser necessária.
   */
  const rolavel = useRef<HTMLDivElement>(null);

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
          fontSize: px(TYPE.title),
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

      <div style={{ ...caixa(BAG_LAYOUT.grid), display: "flex", gap: px(BAG_GRID.barraGap) }}>
        <ScrollbarHider />
        <div
          ref={rolavel}
          className="chat-scroll"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: `repeat(${BAG_GRID.cols}, 1fr)`,
            // `auto` e não `1fr`: com fileira fracionária a grade tentaria
            // caber TODAS na altura visível, e os slots encolheriam conforme o
            // inventário enchesse. A fileira tem a altura do slot, e o que
            // passar da moldura rola.
            gridAutoRows: slotPx,
            gap,
            alignContent: "start",
          }}
        >
        {Array.from({ length: total }).map((_, i) => {
          const it = items[i];
          return (
            <Slot
              key={it ? it.index : `vazio-${i}`}
              // o nome de verdade, do catálogo (`net/itemCatalog`). Enquanto ele
              // não volta da API, o `#id` — a lacuna honesta.
              rotulo={it ? encurtarNome(nomes[it.itemId]?.name ?? `#${it.itemId}`) : undefined}
              quantidade={it && it.amount > 1 ? it.amount : undefined}
              equipado={it?.equipped}
              titulo={
                it
                  ? `${nomes[it.itemId]?.name ?? `#${it.itemId}`}${it.refine ? ` +${it.refine}` : ""}${it.equipped ? " (equipado)" : ""} — ${
                      EQUIP_TYPES.has(it.type)
                        ? "duplo clique equipa"
                        : it.type === CARD_TYPE
                          ? "duplo clique compõe num equipamento"
                          : "clique usa"
                    }, botão direito mostra informação, arraste pro mundo joga no chão`
                  : undefined
              }
              onClick={it && CONSUMABLE_TYPES.has(it.type) ? () => usar(it) : undefined}
              onDoubleClick={
                it
                  ? EQUIP_TYPES.has(it.type)
                    ? () => equipar(it)
                    : it.type === CARD_TYPE
                      ? () => useCardStore.getState().abrir(it.index)
                      : undefined
                  : undefined
              }
              onInfo={it ? () => useItemInfoStore.getState().abrir(it.index) : undefined}
              indice={it?.index}
              lado={slotPx}
            />
          );
        })}
        </div>
        <ChatScrollbar alvo={rolavel} revisao={items.length} largura={barraW} auto />
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
            font: `${px(TYPE.label)}px ${FRAME_FONT}`,
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
      border={px(CHROME.tabBorder)}
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
          fontSize: px(TYPE.tab),
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
  onDoubleClick,
  onInfo,
  indice,
  lado,
}: {
  rotulo?: string;
  quantidade?: number;
  equipado?: boolean;
  titulo?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onInfo?: () => void;
  indice?: number;
  /** lado do slot em px de tela — moldura, ícone e número saem daqui */
  lado: number;
}) {
  const frame = useNineSlice(SLOT_FRAME);
  const [hover, setHover] = useState(false);

  /**
   * O nome mora numa faixa ABAIXO do quadrado, não dentro dele.
   *
   * Dentro cabia uma palavra e meia — e nome de item do RO ("Wing Of Fly",
   * "Awakening Potion") passa longe disso, então o rótulo saía cortado ou
   * ilegível por cima do ícone. Aqui ele tem a largura inteira da célula e uma
   * linha só, com reticência quando não couber.
   */
  const alturaNome = Math.max(9, lado * 0.22);
  const quadrado = Math.max(12, lado - alturaNome - lado * 0.06);
  const borda = Math.max(6, quadrado * 0.24);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      // Botão direito abre a informação do item — jogar no chão agora é o
      // ARRASTE pro mundo (`net/worldDropStore`), com confirmação e escolha
      // de quantidade. O botão direito nunca teve confirmação nenhuma (jogava
      // 1 na hora), e reaproveitá-lo pra abrir só um popup de leitura, sem
      // pedido nenhum ao servidor, é o que tira esse risco de vez.
      onContextMenu={(e) => {
        e.preventDefault();
        onInfo?.();
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      draggable={indice != null}
      onDragStart={(e) => {
        if (indice == null) return;
        e.dataTransfer.setData("application/x-ro-item", String(indice));
        // sem isto o navegador escolhe o ícone sozinho — e o padrão do Chrome
        // pra um `<div>` genérico costuma ser "copy" (o sinal de "+"), que não
        // combina com o cursor do jogo. "move" é o mais perto de um arraste
        // comum, sem selo nenhum por cima.
        e.dataTransfer.effectAllowed = "move";
        // o "fantasma" do arraste nativo não lê `cursor: url(...)` — é
        // `setDragImage` ou nada. Sem isto o navegador desenhava uma captura
        // semitransparente do PRÓPRIO slot (moldura, ícone, tudo); com isto é
        // o cursor_normal do jogo que segue o mouse.
        const arte = dragImagemNormal();
        if (arte) e.dataTransfer.setDragImage(arte.img, arte.hotspot[0], arte.hotspot[1]);
      }}
      title={titulo}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        cursor: onClick || onDoubleClick ? "pointer" : "default",
        transform: hover && (onClick || onDoubleClick) ? "translateY(-2px)" : "none",
        filter: hover && (onClick || onDoubleClick) ? "brightness(1.12)" : undefined,
        transition: "transform 110ms ease-out, filter 110ms ease-out",
      }}
    >
      {/* o quadrado do ícone — tudo o que era `inset: 0` mora aqui dentro */}
      <div style={{ position: "relative", width: quadrado, height: quadrado, flex: "0 0 auto" }}>
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
          {/* sem `label`: o nome saiu de DENTRO do quadrado e foi para a faixa
              abaixo dele (ver `Slot`) — cabia uma palavra e meia aqui, e nome de
              item do RO passa longe disso */}
          <IconSquare seed={`item-${rotulo}`} size={lado * 0.56} />
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

      {/**
       * A faixa do nome, sob o quadrado.
       *
       * Uma linha e reticência: nome de item do RO chega a três palavras, e
       * deixar quebrar empurraria a fileira de baixo para fora da grade — a
       * altura de cada célula é fixa pela arte da bolsa.
       */}
      {rotulo && (
        <span
          style={{
            width: "100%",
            marginTop: lado * 0.02,
            textAlign: "center",
            fontFamily: FRAME_FONT,
            fontSize: alturaNome * 0.86,
            lineHeight: 1,
            color: BAG_COLORS.ink,
            textShadow: `0 1px 2px ${BAG_COLORS.shadow}`,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: "none",
          }}
        >
          {rotulo}
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
      border={px(CHROME.boxBorder)}
      background={BAG_COLORS.counter}
      style={caixa(rect)}
      inner={{ display: "flex", alignItems: "center", gap: px(4), padding: `0 ${px(6)}px`, overflow: "hidden" }}
    >
      <img
        src={icone}
        alt=""
        draggable={false}
        style={{ height: px(CHROME.iconH), width: "auto", flex: "none", pointerEvents: "none" }}
      />
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontWeight: 700,
          fontSize: px(TYPE.label),
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
          fontSize: px(TYPE.label),
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
