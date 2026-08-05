import { Billboard } from "@react-three/drei";
import { usePlayerStore } from "./playerStore";
import { WorldBar } from "./WorldBar";

/**
 * Barras de HP e SP embaixo do próprio personagem, como no Ragnarok.
 *
 * Os valores são os do servidor (`playerStore`); aqui não se calcula nada. Fica
 * abaixo do boneco de propósito: em cima é onde vai o nome dos outros, e duas
 * informações no mesmo lugar competem pela leitura.
 *
 * A moldura é a MESMA das barras de HP/SP do HUD, em textura (`WorldBar`) — no
 * mundo 3D não existe `border-image`.
 */

/**
 * Medidas em frações de célula, como o resto da cena.
 *
 * A barra engordou (0,10 → 0,115 de célula) pelo mesmo motivo da plaquinha do
 * mob: a moldura pintada tem traço e canto, e no fio de antes o desenho não
 * aparecia.
 *
 * O vão entre HP e SP é NEGATIVO de propósito: as duas ficam coladas, com as
 * molduras se encostando. Um vão positivo separava as barras em dois objetos e
 * elas liam como coisas distintas; encostadas, leem como um bloco só — que é
 * como a placa do personagem no HUD as mostra. O recuo de meio traço faz as
 * duas bordas virarem uma linha só em vez de somarem espessura.
 */
const BARRA = { w: 0.72, h: 0.115, vao: -0.008 } as const;

export function SelfBars({ cellSize }: { cellSize: number }) {
  const stats = usePlayerStore((s) => s.stats);
  const known = usePlayerStore((s) => s.known);
  if (!known) return null;

  const width = cellSize * BARRA.w;
  const height = cellSize * BARRA.h;
  const passo = height + cellSize * BARRA.vao;
  const hp = stats.maxHp > 0 ? stats.hp / stats.maxHp : 0;
  const sp = stats.maxSp > 0 ? stats.sp / stats.maxSp : 0;

  return (
    // O Billboard fica NOS PÉS e as barras descem em Y LOCAL — que, num
    // billboard, é o eixo vertical DA TELA, não o do mundo. Subir em Y do mundo
    // não resolve: com a câmera olhando de cima, um plano na altura da canela
    // se projeta em cima do tronco (foi o que aconteceu). Descendo na tela, as
    // barras ficam abaixo do personagem em qualquer ângulo de câmera, como as
    // do Ragnarok.
    <Billboard position={[0, 0, 0]}>
      {/* as duas cores são as paradas MÉDIAS de `HP_FILL` e `SP_FILL`, os
          gradientes medidos da arte da placa do personagem */}
      <group position={[0, -passo, 0]}>
        <WorldBar width={width} height={height} frac={hp} color="#56712a" semProfundidade />
      </group>
      <group position={[0, -passo * 2, 0]}>
        <WorldBar width={width} height={height} frac={sp} color="#36516f" semProfundidade />
      </group>
    </Billboard>
  );
}
