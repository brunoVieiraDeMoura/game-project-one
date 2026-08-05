import { beforeEach, describe, expect, it } from "vitest";
import { cursorAtivo, regraDeCursor, useCursorStore } from "./cursorStore";

/**
 * Qual cursor ganha quando mais de um estado está pedindo.
 *
 * As fontes não se conhecem — `NetEntity` sabe de monstro, `GroundItems` sabe de
 * drop, `GroundInteract` sabe de bloqueio — e o ponteiro passa por elas em
 * qualquer ordem. Se quem chegasse por último vencesse, sair de cima de um mob
 * passando por um item deixaria o cursor no estado errado, e a ordem dos eventos
 * do R3F (`pointerover` do novo antes do `pointerout` do velho) tornaria isso
 * comum em vez de raro.
 *
 * Por isso a resolução é uma PRIORIDADE fixa, e por isso os pedidos são
 * CONTADOS: com vários mobs na tela o ponteiro entra num antes de sair do outro.
 */

const st = () => useCursorStore.getState();

beforeEach(() => st().limpar());

describe("prioridade entre cursores", () => {
  it("sem ninguém pedindo, é o normal", () => {
    expect(cursorAtivo(st().pedidos)).toBe("normal");
  });

  it("ataque ganha de tudo — o monstro está na frente do chão", () => {
    st().pedir("block", true);
    st().pedir("hand", true);
    st().pedir("attack", true);
    expect(cursorAtivo(st().pedidos)).toBe("attack");
  });

  it("mão ganha do bloqueio: o item está POR CIMA da célula", () => {
    st().pedir("block", true);
    st().pedir("hand", true);
    expect(cursorAtivo(st().pedidos)).toBe("hand");
  });

  it("a ordem em que chegaram não muda nada", () => {
    st().pedir("attack", true);
    st().pedir("block", true);
    expect(cursorAtivo(st().pedidos)).toBe("attack");
    st().limpar();
    st().pedir("block", true);
    st().pedir("attack", true);
    expect(cursorAtivo(st().pedidos)).toBe("attack");
  });
});

describe("a regra global carrega o VALOR do cursor", () => {
  it("nunca usa `inherit` — foi assim que o cursor sumiu inteiro", () => {
    /**
     * REGRESSÃO. A primeira versão da regra era
     * `*,*::before,*::after{cursor:inherit !important}`, com o valor escrito em
     * `body.style.cursor`. Só que `*` casa com o `<body>` TAMBÉM e `!important`
     * de folha vence estilo inline: a regra anulava o valor que ela deveria
     * distribuir, e todo mundo herdava o `auto` do `<html>`. Resultado: os
     * ícones pararam de aparecer.
     *
     * A regra tem de trazer o valor junto. Uma declaração de cursor no
     * documento, e é esta.
     */
    const regra = regraDeCursor("url('data:image/png;base64,AAA') 0 0, default");
    expect(regra).not.toContain("inherit");
    expect(regra).toContain("url(");
    expect(regra).toContain("!important");
  });

  it("o valor entra inteiro, com hotspot e fallback", () => {
    // o data URI tem `;` dentro das aspas; se alguém trocar por interpolação
    // que escape ou corte, a declaração quebra no meio e o cursor volta ao do
    // sistema sem erro nenhum no console
    const css = "url('data:image/png;base64,iVBORw0KGgo=') 7 3, crosshair";
    expect(regraDeCursor(css)).toContain(`*,*::before,*::after{cursor:${css} !important}`);
  });

  it("cobre o placeholder do campo de texto — o `*` não chega lá", () => {
    /**
     * O navegador desenha o placeholder num pseudo-elemento DENTRO do widget, e
     * o `*` não atravessa essa fronteira: sobre ele o cursor voltava a ser o do
     * sistema. É exatamente a área em que se clica num input vazio.
     */
    const regra = regraDeCursor("url('x') 0 0, default");
    expect(regra).toContain("::placeholder{");
    expect(regra).toContain("::-webkit-input-placeholder{");
    expect(regra).toContain("::-moz-placeholder{");
  });

  it("cada seletor em sua PRÓPRIA regra", () => {
    /**
     * Um seletor desconhecido invalida a lista inteira em que aparece: juntar
     * `::-moz-placeholder` com o `*` faria o Chrome descartar a regra do `*`
     * junto, apagando o cursor do site inteiro. Separados, cada navegador
     * ignora só o que não conhece.
     */
    const regra = regraDeCursor("url('x') 0 0, default");
    expect(regra).not.toContain(",::-moz-placeholder");
    expect(regra).not.toContain(",::-webkit-input-placeholder");
    // quatro regras, quatro blocos
    expect(regra.split("{").length - 1).toBe(4);
  });
});

describe("pedidos contados", () => {
  it("dois mobs: sair de um não tira o cursor de ataque", () => {
    /**
     * O caso real: com mobs encostados, o R3F dispara o `pointerover` do
     * segundo ANTES do `pointerout` do primeiro. Com um booleano, o `out`
     * apagaria o estado que o `over` acabou de pedir.
     */
    st().pedir("attack", true); // entra no mob A
    st().pedir("attack", true); // entra no mob B
    st().pedir("attack", false); // sai do mob A
    expect(cursorAtivo(st().pedidos)).toBe("attack");
    st().pedir("attack", false); // sai do mob B
    expect(cursorAtivo(st().pedidos)).toBe("normal");
  });

  it("desligar a mais não deixa o contador negativo", () => {
    // um desmonte pode desfazer um pedido que o `pointerout` já desfez
    st().pedir("hand", true);
    st().pedir("hand", false);
    st().pedir("hand", false);
    expect(st().pedidos.hand ?? 0).toBe(0);
    st().pedir("hand", true);
    expect(cursorAtivo(st().pedidos)).toBe("hand");
  });

  it("limpar apaga tudo, inclusive o botão apertado", () => {
    st().pedir("attack", true);
    st().setPressionado(true);
    st().limpar();
    expect(cursorAtivo(st().pedidos)).toBe("normal");
    expect(st().pressionado).toBe(false);
  });
});
