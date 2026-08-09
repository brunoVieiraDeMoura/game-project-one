import { useEffect, useState } from "react";
import { create } from "zustand";
import { aoMontarCursor, cursorCss, precarregarCursores, type CursorKind } from "./cursors";

/**
 * Qual cursor está valendo AGORA.
 *
 * O estado é um só e vem de fontes diferentes da cena: passar sobre um monstro,
 * sobre um item no chão, sobre célula bloqueada. Elas não se conhecem, então
 * quem resolve o conflito é a PRIORIDADE fixa abaixo, não a ordem em que os
 * eventos chegaram — sem isso, sair de cima de um mob com o ponteiro passando
 * por um item deixava o cursor no estado errado.
 *
 * Cada fonte só liga/desliga o que ela sabe. `over` é o que se está apontando;
 * `pressionado` é o botão do mouse, e vale para qualquer um deles.
 */

/**
 * Do mais forte para o mais fraco.
 *
 * A mira de skill vem PRIMEIRO porque ela é um MODO: com uma skill de área
 * escolhida, o próximo clique aponta a magia, não ataca nem pega item — o cursor
 * tem de dizer isso mesmo passando por cima de um mob.
 */
const PRIORIDADE: CursorKind[] = ["skillshot", "attack", "hand", "block", "normal"];

interface CursorState {
  /** quantas fontes pedem cada estado (um mob some enquanto outro é apontado) */
  pedidos: Partial<Record<CursorKind, number>>;
  pressionado: boolean;
  pedir: (kind: CursorKind, ligado: boolean) => void;
  setPressionado: (v: boolean) => void;
  /** fim de sessão / troca de cena: ninguém sobrou apontando nada */
  limpar: () => void;
}

export const useCursorStore = create<CursorState>((set) => ({
  pedidos: {},
  pressionado: false,
  pedir: (kind, ligado) =>
    set((s) => {
      const atual = s.pedidos[kind] ?? 0;
      const proximo = Math.max(0, atual + (ligado ? 1 : -1));
      if (proximo === atual) return s;
      return { pedidos: { ...s.pedidos, [kind]: proximo } };
    }),
  setPressionado: (pressionado) => set({ pressionado }),
  limpar: () => set({ pedidos: {}, pressionado: false }),
}));

/** o estado vencedor, pela prioridade fixa */
export function cursorAtivo(pedidos: Partial<Record<CursorKind, number>>): CursorKind {
  for (const k of PRIORIDADE) if ((pedidos[k] ?? 0) > 0) return k;
  return "normal";
}

/**
 * A regra que veste TUDO com o cursor de agora.
 *
 * O `*` já cobre todo elemento da página, mas campo de texto tem duas partes que
 * ele NÃO alcança: os pseudo-elementos de placeholder, que o navegador desenha
 * dentro do próprio widget. `*` não atravessa essa fronteira, e sobre eles o
 * cursor voltava a ser o do sistema — que é justamente a área onde se clica num
 * input vazio.
 *
 * Os seletores de placeholder ficam em regras SEPARADAS de propósito: um
 * seletor desconhecido invalida a lista inteira em que está (o `-moz-` derruba a
 * regra no Chrome e vice-versa), então juntá-los com o `*` apagaria o cursor do
 * site em algum navegador.
 */
export function regraDeCursor(css: string): string {
  const decl = `{cursor:${css} !important}`;
  return [
    `*,*::before,*::after${decl}`,
    `::placeholder${decl}`,
    `::-webkit-input-placeholder${decl}`,
    `::-moz-placeholder${decl}`,
  ].join("");
}

/**
 * A única regra de CSS que o cursor precisa — e ela carrega o VALOR.
 *
 * Herança sozinha não bastaria: o navegador dá cursor PRÓPRIO a alguns
 * elementos (`text` em `input`/`textarea`, `default` em `button`) e estilo de
 * agente de usuário ganha da herança — era isso o "no /login, o campo de texto
 * não fica com o cursor_normal". O `!important` também vence o
 * `cursor: pointer` que os botões do projeto trazem em estilo INLINE; num jogo
 * com cursor próprio, um ponteiro do sistema no meio quebra a ilusão.
 *
 * ## Por que o valor vem AQUI, e não de `body.style.cursor`
 *
 * Porque `cursor: inherit !important` no `*` faz o cursor sumir por completo, e
 * foi o que aconteceu: o seletor casa com o `<body>` TAMBÉM, e `!important` de
 * folha vence estilo inline — o valor escrito em `body.style.cursor` era
 * anulado pela própria regra, e todo mundo acabava herdando o `auto` do
 * `<html>`.
 *
 * Pondo o valor na regra não há essa mordida de rabo: existe UMA declaração de
 * cursor no documento, e é esta. Reemitir a regra a cada troca custa reescrever
 * um `<style>` — coisa que acontece algumas vezes por segundo no pior caso, ao
 * passar o mouse por um monstro.
 */
export function CursorGlobalStyle() {
  const pedidos = useCursorStore((s) => s.pedidos);
  const pressionado = useCursorStore((s) => s.pressionado);
  // o cursor é montado num canvas de forma ASSÍNCRONA; este contador é o que
  // repinta quando ele fica pronto (senão a primeira passada ficaria no
  // fallback do sistema para sempre)
  const [, repintar] = useState(0);

  useEffect(() => {
    precarregarCursores();
    return aoMontarCursor(() => repintar((v) => v + 1));
  }, []);

  return (
    <style id={CURSOR_STYLE_ID}>{regraDeCursor(cursorCss(cursorAtivo(pedidos), pressionado))}</style>
  );
}

/** id estável — é por ele que `forcarRepaintDoCursor` acha a regra sem precisar de ref/contexto */
const CURSOR_STYLE_ID = "cursor-global-style";

/**
 * Força o navegador a repintar o cursor depois de um arraste nativo (HTML5
 * drag-and-drop).
 *
 * O `dragend` já reseta o ESTADO certo (`pressionado`, e por tabela a regra
 * de CSS que `CursorGlobalStyle` escreve) — mas o que fica preso na tela não
 * é esse CSS, é o "fantasma" que o Windows/Chromium desenha por CIMA da
 * página enquanto o arraste está ativo. Esse desenho vive numa camada de
 * composição PRÓPRIA do sistema operacional, fora do pipeline normal de
 * pintura da página, e só é invalidado no PRÓXIMO evento de entrada real que
 * chegar ao SO (um clique, por exemplo — é por isso que clicar "conserta":
 * não é o clique corrigindo nosso estado, que já estava certo, é o clique
 * sendo o primeiro evento real depois do drag).
 *
 * A troca dupla (`none` → o valor certo, no quadro seguinte) é o jeito
 * conhecido de forçar essa camada a repintar sem esperar por um clique de
 * verdade: `body.style.cursor` sozinho NÃO bastaria (a regra `*{cursor:...
 * !important}` de `regraDeCursor` sempre venceria um `style` inline sem
 * `!important` — o mesmo motivo que fez o projeto abandonar `body.style.
 * cursor` da primeira vez, ver comentário de `CursorGlobalStyle` acima), então
 * quem é mexido aqui é a PRÓPRIA regra do `<style>` que já manda no cursor.
 */
function forcarRepaintDoCursor(): void {
  const el = document.getElementById(CURSOR_STYLE_ID);
  if (!el) return;
  el.textContent = regraDeCursor("none");
  requestAnimationFrame(() => {
    const s = useCursorStore.getState();
    el.textContent = regraDeCursor(cursorCss(cursorAtivo(s.pedidos), s.pressionado));
  });
}

/**
 * Escuta o botão do mouse — o "afunda e volta" do clique.
 *
 * Vale para qualquer cursor, então é escutado uma vez só, na janela.
 *
 * ## Fase de CAPTURA, não de bolha
 *
 * O `pointerup` na bolha é o último a saber: qualquer `stopPropagation` no
 * caminho — e o projeto tem vários, no monstro, no item do chão e no R3F —
 * impede que ele chegue à janela. Aí o cursor fica preso na versão pressionada
 * (12% menor) para sempre, e o jogador vê um cursor que não é o normal sem nada
 * óbvio para desfazer. Na captura o evento passa por aqui ANTES de qualquer um
 * poder engoli-lo.
 *
 * O `pointerup` fica na janela (e não no elemento) pelo motivo de sempre: soltar
 * o botão fora do elemento em que se apertou também tem de contar.
 */
export function useCursorGlobal(): void {
  useEffect(() => {
    const setPressionado = useCursorStore.getState().setPressionado;
    const down = () => setPressionado(true);
    const up = () => setPressionado(false);
    // só o FIM de um arraste nativo precisa do empurrão de repintura — o
    // "fantasma" do SO só existe enquanto um `drag` HTML5 está em andamento
    const dragend = () => {
      setPressionado(false);
      forcarRepaintDoCursor();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    // arrastar texto de dentro de um input termina em `dragend`, não em
    // `pointerup` — sem isto, selecionar e arrastar deixava o cursor afundado
    window.addEventListener("dragend", dragend, true);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("dragend", dragend, true);
      window.removeEventListener("blur", up);
    };
  }, []);
}

/**
 * Liga um estado de cursor enquanto o componente estiver "por cima".
 *
 * Contado, não booleano: com vários mobs na tela o ponteiro entra num antes de
 * sair do outro, e um booleano deixaria o cursor de ataque preso.
 */
export function usarCursorEnquanto(kind: CursorKind, ativo: boolean): void {
  useEffect(() => {
    if (!ativo) return;
    const pedir = useCursorStore.getState().pedir;
    pedir(kind, true);
    return () => pedir(kind, false);
  }, [kind, ativo]);
}
