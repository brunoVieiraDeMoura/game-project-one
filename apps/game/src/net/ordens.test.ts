import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O socket fica FORA deste teste.
 *
 * `net/acoes` emite de verdade (`action:attack`), e `gateway()` abre uma conexão
 * socket.io na primeira chamada — em Node isso estoura antes de a asserção
 * acontecer. O que se testa aqui é a ordem em andamento, não o pacote; o pacote
 * é assunto do gateway.
 */
vi.mock("./gateway", () => ({ gateway: () => ({ emit: () => {} }) }));
import { celulaParaEncostar, distanciaDeAtaque, useAttackStore } from "./attackStore";
import { usePickupStore } from "./pickupStore";
import { cliqueVaiParaOChao, useAimStore } from "./aimStore";
import { useSkillWalkStore } from "./skillWalkStore";
import { atacar, pegar } from "./acoes";
import { cursorAtivo, useCursorStore } from "../ui/cursorStore";

/**
 * As ORDENS em andamento: "vou até ali bater", "vou até ali pegar" e "vou até o
 * alcance e lanço a magia".
 *
 * As três existem porque o rAthena não faz nenhuma delas por conta do jogador —
 * ele recusa de longe e devolve o problema para o cliente (`clif_movetoattack`
 * em unit.cpp:3259; `check_distance` em `pc_takeitem`; `unit_skilluse_pos2` em
 * unit.cpp:2690). São ordens de VÁRIOS quadros, e por isso podem ser canceladas
 * no meio.
 */

const atk = () => useAttackStore.getState();
const pick = () => usePickupStore.getState();
const magia = () => useSkillWalkStore.getState();

/** a mesma ordem de magia pendente em todos os testes abaixo */
const STORM = { skillId: 89, level: 5, name: "Storm Gust", x: 150, y: 150, raio: 9 };

beforeEach(() => {
  atk().parar();
  atk().marcarAtaqueVisto(0);
  pick().parar();
  magia().parar();
  useAimStore.getState().cancel();
  useCursorStore.getState().limpar();
});

describe("cancelar a ida até o alvo", () => {
  it("parar a perseguição NÃO solta o alvo selecionado", () => {
    /**
     * A regra pedida: clicar no chão cancela o "ir até ele bater", mas a placa
     * do monstro continua na tela. São duas coisas diferentes — a ordem de
     * caminhar e o que se está olhando —, e o alvo mora no `worldStore.target`,
     * que este store nem toca.
     */
    atk().perseguir({ gid: 42, x: 10, y: 10, range: 1 });
    expect(atk().alvo?.gid).toBe(42);
    atk().parar();
    expect(atk().alvo).toBeNull();
  });

  it("uma ordem nova substitui a anterior", () => {
    atk().perseguir({ gid: 1, x: 5, y: 5, range: 1 });
    atk().perseguir({ gid: 2, x: 9, y: 9, range: 3 });
    expect(atk().alvo?.gid).toBe(2);
    expect(atk().alvo?.range).toBe(3);
  });

  it("a ordem carimba a HORA — é dela que sai a desistência", () => {
    // sem prazo, um alvo inalcançável faria o personagem tentar para sempre
    const antes = performance.now();
    atk().perseguir({ gid: 7, x: 1, y: 1, range: 1 });
    expect(atk().alvo!.desde).toBeGreaterThanOrEqual(antes);
  });

  it("renovar o MESMO alvo não reinicia o relógio da desistência", () => {
    /**
     * O servidor recusa por distância várias vezes ao longo de uma aproximação
     * (uma por tentativa). Se cada recusa reiniciasse o prazo, o teto de 12 s
     * nunca chegaria e um alvo inalcançável seria perseguido para sempre — que
     * é exatamente o que o teto existe para impedir.
     */
    atk().perseguir({ gid: 5, x: 1, y: 1, range: 1 });
    const inicio = atk().alvo!.desde;
    atk().perseguir({ gid: 5, x: 2, y: 2, range: 1 });
    expect(atk().alvo!.desde).toBe(inicio);
    // alvo DIFERENTE é ordem nova: relógio zerado
    atk().perseguir({ gid: 6, x: 2, y: 2, range: 1 });
    expect(atk().alvo!.desde).toBeGreaterThanOrEqual(inicio);
    expect(atk().alvo!.gid).toBe(6);
  });
});

describe("a distância de ataque é a do SERVIDOR, não Chebyshev", () => {
  /**
   * Portada de `distance_client` (path.cpp:510): `floor(hypot(dx,dy) − 0,1)`.
   * O rAthena comenta o porquê do −0,1 — "this affects even horizontal/vertical
   * lines so they are one cell longer than expected".
   *
   * Usar Chebyshev aqui era mais RÍGIDO que o servidor, e cobrava caro: o
   * cliente insistia em andar uma célula a mais mesmo com o servidor já
   * satisfeito, e esse passo extra disparava outro `clif_fixpos` (unit.cpp:2975,
   * mandado antes do golpe) — o personagem puxado para trás e empurrado para
   * frente, o "teleporte antes de atacar".
   */
  it("duas células na horizontal ainda são alcance 1 — o bônus de 0,1", () => {
    expect(distanciaDeAtaque(2, 0)).toBe(1);
    expect(distanciaDeAtaque(0, 2)).toBe(1);
    // é AQUI que Chebyshev discordava: ela diria 2, e o cliente andaria a mais
    expect(Math.max(2, 0)).toBe(2);
  });

  it("a diagonal encostada é alcance 1", () => {
    // hypot(1,1) = 1,414 − 0,1 = 1,314 → 1
    expect(distanciaDeAtaque(1, 1)).toBe(1);
  });

  it("colado é zero, e nunca negativo", () => {
    expect(distanciaDeAtaque(1, 0)).toBe(0);
    expect(distanciaDeAtaque(0, 0)).toBe(0);
  });

  it("o joelho da curva: (2,1) e (2,2) já são 2", () => {
    // hypot(2,1) = 2,236 − 0,1 = 2,136 → 2
    expect(distanciaDeAtaque(2, 1)).toBe(2);
    // hypot(2,2) = 2,828 − 0,1 = 2,728 → 2
    expect(distanciaDeAtaque(2, 2)).toBe(2);
  });

  it("o sinal não importa — é distância", () => {
    expect(distanciaDeAtaque(-2, 0)).toBe(1);
    expect(distanciaDeAtaque(-1, -1)).toBe(1);
  });
});

describe("encostar no alvo é parar AO LADO, não em cima", () => {
  /**
   * REGRESSÃO. Pedir para andar até a célula do próprio monstro fazia o
   * personagem SEGUIR o alvo: ele nunca chegava, porque o destino era onde o
   * mob está e o pedido era refeito a cada volta da fila. Com `null` quando já
   * dá para bater, a caminhada simplesmente para de ser pedida.
   */
  it("já do lado: não há caminhada a pedir", () => {
    expect(celulaParaEncostar({ x: 5, y: 5 }, { x: 6, y: 5 }, 1)).toBeNull();
    // diagonal também é distância 1 no rAthena
    expect(celulaParaEncostar({ x: 5, y: 5 }, { x: 6, y: 6 }, 1)).toBeNull();
  });

  it("longe: mira a célula ao lado dele, na direção de quem persegue", () => {
    // mob em (10,10), eu em (2,10): paro em (9,10)
    expect(celulaParaEncostar({ x: 2, y: 10 }, { x: 10, y: 10 }, 1)).toEqual({ x: 9, y: 10 });
    // vindo de baixo e da esquerda, paro na diagonal
    expect(celulaParaEncostar({ x: 2, y: 2 }, { x: 10, y: 10 }, 1)).toEqual({ x: 9, y: 9 });
  });

  it("duas células na horizontal JÁ bastam — não anda a mais", () => {
    /**
     * O passo extra que este teste impede é o que disparava o `fixpos` do
     * ataque e produzia o solavanco. O servidor aceita (2,0) com alcance 1.
     */
    expect(celulaParaEncostar({ x: 8, y: 10 }, { x: 10, y: 10 }, 1)).toBeNull();
    // mas (2,1) não: aí ainda falta andar
    expect(celulaParaEncostar({ x: 8, y: 9 }, { x: 10, y: 10 }, 1)).not.toBeNull();
  });

  it("arma de alcance maior para mais longe", () => {
    // com alcance 3 não faz sentido colar nele
    expect(celulaParaEncostar({ x: 0, y: 10 }, { x: 10, y: 10 }, 3)).toEqual({ x: 7, y: 10 });
    expect(celulaParaEncostar({ x: 8, y: 10 }, { x: 10, y: 10 }, 3)).toBeNull();
  });

  it("alcance 0 vale como 1 — ninguém bate de dentro do monstro", () => {
    expect(celulaParaEncostar({ x: 0, y: 0 }, { x: 5, y: 0 }, 0)).toEqual({ x: 4, y: 0 });
  });

  it("em cima dele: devolve a própria célula, sem NaN nem divisão por zero", () => {
    // acontece de verdade — a célula do mob é andável no rAthena
    expect(celulaParaEncostar({ x: 7, y: 7 }, { x: 7, y: 7 }, 1)).toBeNull();
  });
});

describe("o reenvio do ataque é dirigido pelo SERVIDOR", () => {
  /**
   * Cada `action:attack` passa por `unit_stop_attack` no rAthena
   * (clif.cpp:11708), então repetir sem parar zera o cronômetro do golpe e o
   * personagem levanta a arma sem nunca baixar. O reenvio só pode sair em
   * resposta a uma recusa nova — e cada recusa arma exatamente um pedido.
   */
  it("uma recusa arma UM pedido, e só um", () => {
    atk().perseguir({ gid: 3, x: 8, y: 8, range: 1 });
    expect(atk().alvo!.pendente).toBe(true);

    atk().marcarPedido(1000);
    expect(atk().alvo!.pendente).toBe(false);
    expect(atk().alvo!.pedidoEm).toBe(1000);
  });

  it("aceitou? o silêncio encerra — nada é reenviado", () => {
    atk().perseguir({ gid: 3, x: 8, y: 8, range: 1 });
    atk().marcarPedido(1000);
    // sem recusa nova, `pendente` continua falso por quantos quadros forem
    expect(atk().alvo!.pendente).toBe(false);
  });

  it("recusou de novo? arma outro, preservando o instante do anterior", () => {
    atk().perseguir({ gid: 3, x: 8, y: 8, range: 1 });
    atk().marcarPedido(1000);
    // o mob andou e o servidor recusou outra vez
    atk().perseguir({ gid: 3, x: 9, y: 9, range: 1 });
    expect(atk().alvo!.pendente).toBe(true);
    // o intervalo mínimo entre pedidos é medido a partir do ÚLTIMO que saiu
    expect(atk().alvo!.pedidoEm).toBe(1000);
    expect(atk().alvo!.x).toBe(9);
  });

  it("ver o golpe é o que prova que o ataque ENTROU", () => {
    /**
     * `action:attack` não tem resposta de sucesso: o servidor bate, recusa por
     * distância, ou guarda o pedido no `stepaction`. O `entity:action` com o
     * gid do próprio personagem é a única evidência de que ele está batendo — é
     * por ela que a repetição sabe a hora de calar a boca.
     */
    atk().perseguir({ gid: 3, x: 8, y: 8, range: 1 });
    expect(atk().atacandoEm).toBe(0);
    atk().marcarAtaqueVisto(5000);
    expect(atk().atacandoEm).toBe(5000);
  });

  it("cada golpe renova o relógio da desistência", () => {
    /**
     * O teto de 12 s existe para largar um alvo INALCANÇÁVEL. Um combate longo
     * contra um mob de muito HP não é isso — sem renovar, a ordem seria
     * abandonada no meio da luta e o personagem pararia de perseguir se o mob
     * andasse.
     */
    atk().perseguir({ gid: 3, x: 8, y: 8, range: 1 });
    const inicio = atk().alvo!.desde;
    atk().marcarAtaqueVisto(inicio + 9000);
    expect(atk().alvo!.desde).toBe(inicio + 9000);
  });

  it("ver golpe sem ordem viva não ressuscita ordem nenhuma", () => {
    // bater num mob adjacente sem nunca ter havido perseguição
    atk().parar();
    atk().marcarAtaqueVisto(7000);
    expect(atk().alvo).toBeNull();
    expect(atk().atacandoEm).toBe(7000);
  });

  it("`marcarPedido` sem ordem viva não cria ordem nenhuma", () => {
    // clicar num mob adjacente ataca sem nunca haver perseguição
    atk().parar();
    atk().marcarPedido(1234);
    expect(atk().alvo).toBeNull();
  });
});

describe("ir pegar o item", () => {
  it("guarda a célula onde o item caiu", () => {
    pick().buscar({ gid: 900, x: 33, y: 44 });
    expect(pick().alvo).toMatchObject({ gid: 900, x: 33, y: 44 });
  });

  it("atacar e coletar são ordens INDEPENDENTES", () => {
    // quem cancela as duas é o clique no chão, não uma a outra
    atk().perseguir({ gid: 1, x: 2, y: 2, range: 1 });
    pick().buscar({ gid: 900, x: 3, y: 3 });
    expect(atk().alvo).not.toBeNull();
    expect(pick().alvo).not.toBeNull();
  });
});

describe("ir lançar a magia", () => {
  it("guarda a célula e o alcance da skill", () => {
    magia().irLancar(STORM);
    expect(magia().pendente).toMatchObject({ skillId: 89, x: 150, y: 150, raio: 9 });
  });

  it("mandar BATER cancela a magia a caminho", () => {
    /**
     * As três ordens disputam a MESMA caminhada. Duas de pé fariam o personagem
     * trocar de destino sozinho a cada quadro — ele iria até o alcance da magia,
     * o ataque o mandaria para o mob, e assim por diante.
     */
    magia().irLancar(STORM);
    atacar(1234, 10, 10);
    expect(magia().pendente).toBeNull();
  });

  it("mandar PEGAR também cancela", () => {
    magia().irLancar(STORM);
    pegar(900, 12, 12);
    expect(magia().pendente).toBeNull();
  });

  it("escolher OUTRA skill cancela a que estava a caminho", () => {
    /**
     * Sem isto, o personagem chegaria ao alcance da PRIMEIRA e a lançaria no meio
     * da mira da segunda — uma magia que o jogador já tinha trocado.
     */
    magia().irLancar(STORM);
    useAimStore.getState().aim({ id: 90, level: 1, name: "Meteor Storm", mode: "ground" });
    expect(magia().pendente).toBeNull();
  });

  it("a ordem carimba a hora, que é de onde sai a desistência", () => {
    const antes = performance.now();
    magia().irLancar(STORM);
    expect(magia().pendente!.desde).toBeGreaterThanOrEqual(antes);
  });

  it("uma ordem nova substitui a anterior, não empilha", () => {
    magia().irLancar(STORM);
    magia().irLancar({ ...STORM, x: 200, y: 200 });
    expect(magia().pendente).toMatchObject({ x: 200, y: 200 });
  });
});

describe("cursor da mira de skill", () => {
  it("escolher uma skill de mira acende o anel, e cancelar apaga", () => {
    expect(cursorAtivo(useCursorStore.getState().pedidos)).toBe("normal");
    useAimStore.getState().aim({ id: 89, level: 5, name: "Storm Gust", mode: "ground" });
    expect(cursorAtivo(useCursorStore.getState().pedidos)).toBe("skillshot");
    useAimStore.getState().cancel();
    expect(cursorAtivo(useCursorStore.getState().pedidos)).toBe("normal");
  });

  it("escolher uma skill CANCELA a ida até o alvo", () => {
    /**
     * Quem vai lançar magia não está indo bater. Deixar a perseguição de pé
     * fazia o personagem sair correndo atrás do monstro no meio da mira, e o
     * clique que deveria escolher o lugar da skill chegava com ele já em
     * movimento.
     */
    atk().perseguir({ gid: 11, x: 4, y: 4, range: 1 });
    useAimStore.getState().aim({ id: 89, level: 5, name: "Storm Gust", mode: "ground" });
    expect(atk().alvo).toBeNull();
  });

  it("cancelar a mira NÃO ressuscita a perseguição", () => {
    atk().perseguir({ gid: 11, x: 4, y: 4, range: 1 });
    useAimStore.getState().aim({ id: 89, level: 5, name: "Storm Gust", mode: "ground" });
    useAimStore.getState().cancel();
    expect(atk().alvo).toBeNull();
  });

  it("skill de CHÃO: o clique pertence à célula, não ao monstro", () => {
    /**
     * O caso normal de uma skill de área é mirar em cima de um monstro. Enquanto
     * a entidade capturava o clique (`stopPropagation`), o evento nunca chegava
     * ao plano do `GroundInteract` — que é quem manda o `skill:use-ground` — e
     * mirar num mob ou não fazia nada, ou virava ataque normal.
     */
    expect(cliqueVaiParaOChao(null)).toBe(false);
    expect(cliqueVaiParaOChao({ id: 89, level: 5, name: "Storm Gust", mode: "ground" })).toBe(true);
  });

  it("skill de ALVO continua sendo do monstro", () => {
    // aqui o clique escolhe EM QUEM, e a entidade é quem sabe disso
    expect(cliqueVaiParaOChao({ id: 5, level: 1, name: "Bash", mode: "entity" })).toBe(false);
  });

  it("a mira GANHA do monstro — com skill escolhida, o clique aponta a magia", () => {
    /**
     * É a razão de a mira ser a primeira da prioridade: mirar é um MODO, e o
     * próximo clique não vai atacar nem pegar item mesmo que o ponteiro esteja
     * sobre um mob. O cursor tem de dizer isso.
     */
    useCursorStore.getState().pedir("attack", true);
    useAimStore.getState().aim({ id: 89, level: 5, name: "Storm Gust", mode: "ground" });
    expect(cursorAtivo(useCursorStore.getState().pedidos)).toBe("skillshot");
  });

  it("trocar de skill sem cancelar não acende duas vezes", () => {
    // o `subscribe` só age na TROCA de "tem mira / não tem"; com pedidos
    // contados, somar duas e tirar uma deixaria o anel preso na tela
    useAimStore.getState().aim({ id: 1, level: 1, name: "A", mode: "ground" });
    useAimStore.getState().aim({ id: 2, level: 1, name: "B", mode: "entity" });
    useAimStore.getState().cancel();
    expect(cursorAtivo(useCursorStore.getState().pedidos)).toBe("normal");
  });
});
