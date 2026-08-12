import { usePlayerStore } from "../net/playerStore";
import { isArcherClass, isMageClass, isSwordmanClass } from "../entities/classModels";
import { playOneShot } from "./oneShotPool";

/**
 * Vozes de combate, POR CLASSE — cada entrada de `CLASSES` é autocontida
 * (portão + trilhas próprias); nenhuma lógica aqui olha pra classe de outra.
 * Adicionar uma classe nova é adicionar uma entrada nova, nunca tocar nas que
 * já existem (foi assim que Arqueiro entrou depois de Espadachim, sem mexer
 * numa linha da entrada dele).
 *
 * Cada função é chamada pelo EVENTO real do jogo que ela representa
 * (`net/useWorldEvents` para ataque/dano; `play/Player.tsx` para o pulo — ver
 * o comentário de `vozDePulo`), nunca por `useFrame`, `useEffect` de render
 * ou timer.
 */
interface VozesDeClasse {
  souDaClasse: (jobId: number | undefined | null) => boolean;
  /** ausente = esta classe não tem voz de ataque neste lote de assets — não
   * inventar uma reaproveitando a de outra classe */
  ataque?: [string, string];
  dano: [string, string];
  /** ausente = sem asset de morte neste lote (ver Mago, sem `morte` no pacote
   * de voz recebido) — não emprestar a de outra classe */
  morte?: string;
  pulo: string;
  /** ausente = sem asset de conjuração — `vozDeConjuracao()` não toca nada
   * pra esta classe */
  conjuracao?: string;
  /** alternância — ver `vozDeAtaque`/`vozDeDano` */
  proximoAtaque: 0 | 1;
  proximoDano: 0 | 1;
}

const CLASSES: VozesDeClasse[] = [
  {
    souDaClasse: isSwordmanClass,
    ataque: [
      "/assets/audio/combat/swordman/voice/battle-grunt-2.mp3",
      "/assets/audio/combat/swordman/voice/battle-grunt-11.mp3",
    ],
    dano: [
      "/assets/audio/combat/swordman/voice/damage-grunt-3.mp3",
      "/assets/audio/combat/swordman/voice/damage-grunt-14.mp3",
    ],
    morte: "/assets/audio/combat/swordman/voice/death-1.mp3",
    pulo: "/assets/audio/combat/swordman/voice/jump-1.mp3",
    proximoAtaque: 0,
    proximoDano: 0,
  },
  {
    souDaClasse: isArcherClass,
    // sem `ataque`: o lote de assets do Arqueiro não trouxe voz de golpe
    // básico (só dano/morte/pulo) — nenhuma entrada aqui, nenhum som tocado
    // pra isso, em vez de tomar emprestada a do Espadachim.
    dano: [
      "/assets/audio/combat/archer/voice/damage-grunt-3.mp3",
      "/assets/audio/combat/archer/voice/damage-grunt-14.mp3",
    ],
    morte: "/assets/audio/combat/archer/voice/death-1.mp3",
    pulo: "/assets/audio/combat/archer/voice/jump-1.mp3",
    proximoAtaque: 0,
    proximoDano: 0,
  },
  {
    souDaClasse: isMageClass,
    ataque: [
      "/assets/audio/combat/mage/voice/attack-1.mp3",
      "/assets/audio/combat/mage/voice/attack-2.mp3",
    ],
    dano: [
      "/assets/audio/combat/mage/voice/damage-1.mp3",
      "/assets/audio/combat/mage/voice/damage-2.mp3",
    ],
    // sem `morte`: o pacote de voz feminina do Mago não trouxe som de morte —
    // nenhuma entrada aqui, nenhum som tocado, em vez de tomar emprestada a
    // do Espadachim/Arqueiro.
    pulo: "/assets/audio/combat/mage/voice/jump-1.mp3",
    conjuracao: "/assets/audio/combat/mage/voice/spell-cast.mp3",
    proximoAtaque: 0,
    proximoDano: 0,
  },
];

function classeAtual(): VozesDeClasse | undefined {
  const jobId = usePlayerStore.getState().stats.class;
  return CLASSES.find((c) => c.souDaClasse(jobId));
}

/** chamar do MESMO handler `entity:action` que já decide "foi o meu ataque"
 * (`gid === selfGid`) — nunca um segundo listener. */
export function vozDeAtaque(): void {
  const c = classeAtual();
  if (!c?.ataque) return;
  playOneShot(c.ataque[c.proximoAtaque]);
  c.proximoAtaque = c.proximoAtaque === 0 ? 1 : 0;
}

/** chamar quando `targetGid === selfGid` E `damage > 0` no mesmo evento —
 * dano zero é esquiva/erro contra VOCÊ, não é "levar dano". */
export function vozDeDano(): void {
  const c = classeAtual();
  if (!c) return;
  playOneShot(c.dano[c.proximoDano]);
  c.proximoDano = c.proximoDano === 0 ? 1 : 0;
}

function vozDeMorte(): void {
  const c = classeAtual();
  if (!c?.morte) return;
  playOneShot(c.morte);
}

/** chamar do MESMO `skill:cast` que já dispara `audio/combatWeapon.efeitoDeSkill`,
 * só que pra QUALQUER skill lançada (não só as que têm efeito de arma
 * configurado) — "spell_cast" é o grito de conjuração da classe, independe
 * de qual magia foi. */
export function vozDeConjuracao(): void {
  const c = classeAtual();
  if (!c?.conjuracao) return;
  playOneShot(c.conjuracao);
}

/**
 * PULO — limitação encontrada na auditoria, documentada em vez de escondida:
 * não existe pacote/evento de pulo no protocolo do rAthena (RO de verdade não
 * pula) nem no caminho ONLINE (`net/NetPlayer`) deste cliente. O ÚNICO pulo
 * REAL do código inteiro é o da barra de espaço em `play/Player.tsx` — o
 * personagem OFFLINE/demo (mundo local, sem sessão), que nunca é montado ao
 * mesmo tempo que uma sessão de verdade (`views/PlayView.tsx` escolhe
 * `NetPlayer` OU `Player`, nunca os dois) e cujo `playerStore.stats.class`
 * fica no padrão `0` (nunca semeado por um `char:select` real).
 *
 * Vale pra QUALQUER classe deste registro, não só Espadachim: o gatilho e o
 * portão de classe estão corretos, mas as duas condições (classe de verdade +
 * pulo de verdade) nunca se cruzam numa sessão online hoje.
 */
export function vozDePulo(): void {
  const c = classeAtual();
  if (!c) return;
  playOneShot(c.pulo);
}

/**
 * Morte — mesma lacuna que o pedido pede pra investigar: o rAthena não manda
 * um pacote de "você morreu", só HP chegando a 0 (`self:stat`/`self:status`).
 * A borda (>0 → ≤0) é o evento real; ficar em 0 não repete (o `subscribe` só
 * chama de novo quando o STORE muda, e uma vez em 0 o `anterior.stats.hp`
 * também já é 0 — a condição não volta a ser verdadeira até o personagem
 * reviver e morrer de novo).
 */
usePlayerStore.subscribe((estado, anterior) => {
  if (anterior.stats.hp > 0 && estado.stats.hp <= 0) vozDeMorte();
});

/** SÓ PARA TESTE — reseta a alternância de TODAS as classes entre casos de teste. */
export function __resetForTests(): void {
  for (const c of CLASSES) {
    c.proximoAtaque = 0;
    c.proximoDano = 0;
  }
}
