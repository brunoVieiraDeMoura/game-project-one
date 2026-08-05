import type { NetEntity } from "./worldStore";

/**
 * O que de uma entidade do mundo realmente MUDA O DESENHO.
 *
 * ## Por que isto existe
 *
 * O `move` do `worldStore` cria um objeto novo por pacote de movimento, por
 * entidade — é o preço de um store imutável e está certo. O problema era do
 * outro lado: o `NetEntityView` assinava `s.entities[gid]` INTEIRO, então cada
 * passo de cada mob re-renderizava a subárvore toda dele (área de clique,
 * brilho de chão, plaquinha e a barra de três malhas). E o `<Text>` do drei
 * chama `troikaMesh.sync()` num `useLayoutEffect` SEM array de dependências,
 * ou seja, o atlas de glifo era re-sincronizado em cada um desses renders.
 *
 * Com 120 mobs andando o servidor manda ~120 pacotes por segundo, e cada um
 * custava uma reconciliação de subárvore inteira para mover um boneco — sendo
 * que a POSIÇÃO nunca passou por render nenhum: ela é escrita direto no
 * `group.position` dentro do `useFrame` (`net/NetEntity`), lendo o store por
 * `getState()`.
 *
 * Daí a separação: o componente assina só esta fatia, e nada aqui muda quando a
 * entidade anda.
 *
 * ## O que NÃO entra aqui
 *
 * `x`/`y`/`toX`/`toY`/`movedAt`/`durationMs`/`speed`/`dir`/`path`/`stepEnds` —
 * tudo que descreve MOVIMENTO. Quem precisa deles lê `getState()` no quadro, e
 * é lá que eles são consumidos.
 *
 * Travado por `perf/cenarios.test.ts`, dos dois lados: um pacote de movimento
 * não pode mudar a fatia, e mudar HP, nome ou nível PRECISA mudá-la — senão uma
 * fatia vazia passaria no primeiro teste escondendo a barra de vida.
 */
export interface FatiaDeRender {
  /** decide o modelo e o comportamento do clique (mob ataca, npc conversa) */
  kind: NetEntity["kind"];
  /** mobId/classe — escolhe a aparência em `entities/mobModels` */
  job: number;
  name: string | undefined;
  level: number | undefined;
  hp: number | undefined;
  maxHp: number | undefined;
}

export function fatiaDeRender(e: NetEntity): FatiaDeRender {
  return { kind: e.kind, job: e.job, name: e.name, level: e.level, hp: e.hp, maxHp: e.maxHp };
}

/**
 * Comparação rasa entre duas fatias.
 *
 * Existe como função nomeada (em vez do `shallow` do zustand solto no lugar de
 * uso) porque é ela que o teste confere: o dia em que a fatia ganhar um campo,
 * a comparação acompanha sozinha e não há um segundo lugar para esquecer.
 */
export function mesmaFatiaDeRender(a: FatiaDeRender, b: FatiaDeRender): boolean {
  return (
    a.kind === b.kind &&
    a.job === b.job &&
    a.name === b.name &&
    a.level === b.level &&
    a.hp === b.hp &&
    a.maxHp === b.maxHp
  );
}
