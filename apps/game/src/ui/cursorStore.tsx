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

  return <style>{regraDeCursor(cursorCss(cursorAtivo(pedidos), pressionado))}</style>;
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
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    // arrastar texto de dentro de um input termina em `dragend`, não em
    // `pointerup` — sem isto, selecionar e arrastar deixava o cursor afundado
    window.addEventListener("dragend", up, true);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("dragend", up, true);
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
