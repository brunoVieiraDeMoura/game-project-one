import { useEffect, useState } from "react";
import { useItemCatalog, getItemDisplayName } from "../net/itemCatalog";
import { LoadingRing } from "../ui/rpg";
import { CurvedBox } from "../ui/CurvedBox";
import { FRAME_FONT, FRAME_NUM_FONT, FRAME_NUM_VARIANT } from "../ui/charFrame";
import { BOOK } from "../ui/travelbook";
import { CHROME, TYPE, WINDOW_SCALE } from "../ui/windowChrome";
import { useLootStore } from "./lootStore";

/**
 * Aviso de loot: o que acabou de entrar na bolsa, no alto e ao centro.
 *
 * A moldura é a curva das barras (`ui/CurvedBox`) — os dois PNG do pacote
 * `ui_definitiva/loot` são byte a byte (md5 conferido) o `bar-corner` e o
 * `bar-edge` que o repo já tinha, então nenhum arquivo de arte novo entrou.
 *
 * Alto e ao centro porque é onde o olho já está: o HUD ocupa os quatro cantos, e
 * um aviso num deles competiria com a placa do personagem ou com o chat.
 * `pointer-events: none` no bloco inteiro — é informação, não botão, e no meio
 * da tela ele engoliria clique de andar.
 */

/** px de ARTE → px de tela, na MESMA escala das outras janelas */
const px = (v: number) => v * WINDOW_SCALE;

/** medidas em px da ARTE; a escala comum das janelas converte (ui/windowChrome) */
const LOOT = {
  /**
   * O quadrado do ícone.
   *
   * Casado com o CORPO da letra (`TYPE.section`), não com a altura da caixa: um
   * quadrado maior que a linha de texto vira o elemento dominante de um aviso
   * que é sobre a FRASE, e foi o que aconteceu com 26.
   */
  icone: 20,
  padX: 13,
  padY: 8,
  gap: 9,
  /**
   * Distância do topo da tela.
   *
   * Colado no topo ele disputava a borda com a moldura da placa do personagem e
   * ficava difícil de notar — o olho não vai ao canto de cima. Descido, cai na
   * faixa que o jogador já varre, e continua longe do centro (onde engoliria a
   * leitura do combate).
   */
  topo: 64,
} as const;

/**
 * Dourado do nome do item.
 *
 * O `BOOK.gold` da paleta do TravelBook — o mesmo tom do preenchimento das
 * barras. É o amarelo que o jogo já usa; inventar outro faria a frase destoar
 * de tudo o que está na tela.
 */
const COR_NOME = BOOK.gold;

export function LootToast() {
  const aviso = useLootStore((s) => s.aviso);
  const nomes = useItemCatalog((s) => s.byId);

  /**
   * A poda roda num relógio, não no laço de render.
   *
   * Este componente vive no HUD, FORA do `<Canvas>` — não há `useFrame` aqui. Um
   * intervalo curto basta: o que se mede é "sumiu na hora certa" com tolerância
   * de um décimo de segundo, e um `requestAnimationFrame` só para expirar um
   * aviso seria acordar o navegador 60×/s à toa.
   */
  const [, repintar] = useState(0);
  useEffect(() => {
    if (!aviso) return;
    const t = setInterval(() => {
      useLootStore.getState().limpar(performance.now());
      repintar((v) => v + 1);
    }, 120);
    return () => clearInterval(t);
  }, [aviso]);

  // o catálogo é pedido aqui também: o item pode ter sido pego sem nunca ter
  // aparecido no chão (drop direto, comércio), e aí ninguém pediu o nome dele
  const itemId = aviso?.itemId;
  useEffect(() => {
    if (itemId !== undefined) useItemCatalog.getState().ensure([itemId]);
  }, [itemId]);

  if (!aviso) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: px(LOOT.topo),
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "none",
      }}
    >
      <Linha
        key={aviso.id}
        itemId={aviso.itemId}
        amount={aviso.amount}
        // NUNCA id como nome provisório (regra absoluta, auditoria
        // 2026-08-14) — `undefined` enquanto o catálogo não respondeu.
        nome={getItemDisplayName(nomes[aviso.itemId])}
      />
    </div>
  );
}

function Linha({ itemId, amount, nome }: { itemId: number; amount: number; nome?: string }) {
  return (
    <CurvedBox
      border={px(CHROME.tabBorder)}
      // escuro translúcido, como o medalhão do retrato: deixa o mundo aparecer
      // de leve e faz o texto destacar sem competir com a madeira da moldura
      background="rgba(12,9,7,0.82)"
      /**
       * Grade de duas colunas: o ícone no tamanho dele, a frase no resto.
       *
       * `auto 1fr` e não `1fr 1fr`: com colunas iguais, um ícone de 14 px
       * ficaria perdido no meio de metade da caixa e a frase espremida na outra.
       * O `nowrap` no texto é o que garante a linha única, e a caixa cresce com
       * a frase porque nada aqui tem largura fixa.
       *
       * Em `inner`, NÃO em `style`: os filhos moram no elemento de dentro do
       * `CurvedBox`, e o de fora só tem as duas camadas absolutas da moldura. O
       * `display: grid` aplicado lá fora não governava nada — os dois filhos
       * caíam em fluxo normal, um `div` de bloco e um `span`, ou seja, ícone
       * numa linha e mensagem na outra. Era exatamente este o relato.
       */
      inner={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        gap: px(LOOT.gap),
        padding: `${px(LOOT.padY)}px ${px(LOOT.padX)}px`,
      }}
    >
      {/**
       * O ícone, à esquerda.
       *
       * Enquanto não há sprite de item, é o MESMO quadrado colorido por id que
       * a caixinha no chão usa (`GroundItems.colorFor`) — assim o que se viu no
       * chão e o que aparece aqui são a mesma coisa, e trocar por um sprite
       * depois é mexer só neste bloco.
       */}
      {nome ? (
        <div
          style={{
            width: px(LOOT.icone),
            height: px(LOOT.icone),
            borderRadius: px(3),
            background: `hsl(${(itemId * 47) % 360}, 55%, 55%)`,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)",
          }}
        />
      ) : (
        <LoadingRing size={px(LOOT.icone)} />
      )}
      <span
        style={{
          fontFamily: FRAME_FONT,
          fontSize: px(TYPE.section),
          lineHeight: 1.15,
          color: BOOK.parchmentLight,
          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          whiteSpace: "nowrap",
        }}
      >
        {"- Você obteve "}
        {/* NUNCA id como nome provisório (regra absoluta, auditoria
            2026-08-14) — enquanto o catálogo não respondeu, o anel acima já
            avisa "carregando", o texto some em vez de mostrar `#id`. */}
        <span style={{ color: COR_NOME }}>{nome ?? "…"}</span>
        {amount > 1 && (
          <span
            style={{
              fontFamily: FRAME_NUM_FONT,
              fontVariantNumeric: FRAME_NUM_VARIANT,
              color: COR_NOME,
            }}
          >
            {` ×${amount}`}
          </span>
        )}
        .
      </span>
    </CurvedBox>
  );
}
