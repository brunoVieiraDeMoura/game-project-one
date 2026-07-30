import { Billboard } from "@react-three/drei";
import { usePlayerStore } from "./playerStore";

/**
 * Barras de HP e SP embaixo do próprio personagem, como no Ragnarok.
 *
 * Os valores são os do servidor (`playerStore`); aqui não se calcula nada. Fica
 * abaixo do boneco de propósito: em cima é onde vai o nome dos outros, e duas
 * informações no mesmo lugar competem pela leitura.
 */
export function SelfBars({ cellSize }: { cellSize: number }) {
  const stats = usePlayerStore((s) => s.stats);
  const known = usePlayerStore((s) => s.known);
  if (!known) return null;

  const width = cellSize * 0.7;
  const height = cellSize * 0.1;
  const hp = Math.max(0, Math.min(1, stats.maxHp > 0 ? stats.hp / stats.maxHp : 0));
  const sp = Math.max(0, Math.min(1, stats.maxSp > 0 ? stats.sp / stats.maxSp : 0));

  return (
    // O Billboard fica NOS PÉS e as barras descem em Y LOCAL — que, num
    // billboard, é o eixo vertical DA TELA, não o do mundo. Subir em Y do mundo
    // não resolve: com a câmera olhando de cima, um plano na altura da canela
    // se projeta em cima do tronco (foi o que aconteceu). Descendo na tela, as
    // barras ficam abaixo do personagem em qualquer ângulo de câmera, como as
    // do Ragnarok.
    <Billboard position={[0, 0, 0]}>
      <Bar y={-height * 1.1} width={width} height={height} frac={hp} color="#38d16a" />
      <Bar y={-height * 2.25} width={width} height={height} frac={sp} color="#3d9ee0" />
    </Billboard>
  );
}

function Bar({
  y,
  width,
  height,
  frac,
  color,
}: {
  y: number;
  width: number;
  height: number;
  frac: number;
  color: string;
}) {
  // `depthTest: false` + renderOrder alto: as barras ficam nos PÉS, e sem isso o
  // próprio corpo do personagem (e o relevo do terreno) as engole — foi o que
  // aconteceu: elas existiam na cena e não apareciam em lugar nenhum.
  return (
    <group position={[0, y, 0]} renderOrder={999}>
      <mesh renderOrder={999}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#20150f" transparent opacity={0.85} depthTest={false} depthWrite={false} />
      </mesh>
      {frac > 0 && (
        // encolhe pela direita mantendo a borda esquerda parada
        // `transparent` mesmo opaco (opacity 1): o three desenha TODA a lista
        // transparente depois da opaca, e o trilho é transparente. Com o fill
        // fora dessa lista, o trilho passava por cima dele (depthTest false) e a
        // barra ficava preta. Na mesma lista, quem manda é o renderOrder.
        <mesh position={[-(width * (1 - frac)) / 2, 0, 0.001]} renderOrder={1000}>
          <planeGeometry args={[width * frac, height * 0.78]} />
          <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
