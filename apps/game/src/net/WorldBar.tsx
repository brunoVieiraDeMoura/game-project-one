import { useBarFrameTexture } from "../ui/barTexture";
import { GEO_PLANO, materialDeBarra } from "./recursosCompartilhados";

/**
 * Barra de valor desenhada NA CENA, com a moldura pintada das barras de HP/SP.
 *
 * É a mesma peça de arte do HUD (`curva-das-bordas-barra-hp-sp` +
 * `reta-barra-hp-sp`), só que aqui ela chega como TEXTURA em vez de
 * `border-image`: no mundo 3D não existe CSS, e esticar o atlas do 9-slice num
 * plano largo deformaria os cantos. Quem compõe a moldura no tamanho certo é
 * `ui/barTexture.ts`.
 *
 * Três planos empilhados: trilho escuro, preenchimento colorido e a moldura por
 * cima. O preenchimento tem que ser plano PRÓPRIO — a moldura é uma imagem
 * fixa, e é a largura dele que anima o valor.
 */
export function WorldBar({
  width,
  height,
  frac,
  color,
  /**
   * `depthTest: false` é para as barras que ficam nos PÉS do personagem: sem
   * isso o próprio corpo e o relevo do terreno as engolem. A plaquinha do mob
   * fica acima da cabeça e não precisa.
   */
  semProfundidade = false,
}: {
  width: number;
  height: number;
  frac: number;
  color: string;
  semProfundidade?: boolean;
}) {
  const moldura = useBarFrameTexture(width / height);
  const preso = Math.max(0, Math.min(1, frac));
  // o miolo útil fica DENTRO do traço da moldura, senão o preenchimento passa
  // por cima do desenho — é o mesmo `inset` que a `CurvedBar` do HUD usa
  const traco = height * 0.13;
  const util = width - traco * 2;
  const ordem = semProfundidade ? 999 : 0;

  /**
   * Geometria e materiais de MÓDULO — ver `net/recursosCompartilhados`.
   *
   * Os três planos eram criados por BARRA, e há uma plaquinha em cada mob à
   * vista: com `area_size: 60` isso é três geometrias e três materiais por
   * entidade que entra no alcance. Medido numa série de censos andando pelo
   * mapa, dez mobs saindo de cena levavam 25 geometrias e 21 materiais junto —
   * e a maior parte disso era daqui.
   *
   * O plano é UNITÁRIO e o tamanho vai no `scale`, o que também mantém a regra
   * que já existia: mudar `args` de um `planeGeometry` RECONSTRÓI o objeto em
   * R3F, e era por isso que o preenchimento já animava por escala.
   */
  return (
    <group renderOrder={ordem}>
      <mesh
        renderOrder={ordem}
        scale={[width, height, 1]}
        geometry={GEO_PLANO}
        material={materialDeBarra({ cor: "#1b140c", opacity: 0.88, depthTest: !semProfundidade })}
      />
      {preso > 0 && (
        /**
         * Encolhe pela direita mantendo a borda esquerda parada — por ESCALA,
         * não por tamanho de geometria.
         *
         * Antes o `args` do `planeGeometry` dependia da fração de HP, e em R3F
         * mudar `args` RECONSTRÓI o objeto: cada golpe em cada mob criava e
         * descartava uma `BufferGeometry`. Com o plano fixo em `util × altura` e
         * o valor indo no `scale.x`, um combate inteiro não aloca nada.
         *
         * `transparent` mesmo opaco: o three desenha toda a lista transparente
         * depois da opaca, e o trilho é transparente — com o fill fora dessa
         * lista o trilho passaria por cima dele.
         */
        <mesh
          position={[-(util * (1 - preso)) / 2, 0, 0.001]}
          // o tamanho do miolo e a fração do valor entram na MESMA escala
          scale={[util * preso, height - traco * 2, 1]}
          renderOrder={ordem + 1}
          geometry={GEO_PLANO}
          material={materialDeBarra({ cor: color, depthTest: !semProfundidade })}
        />
      )}
      {moldura && (
        <mesh
          position={[0, 0, 0.002]}
          scale={[width, height, 1]}
          renderOrder={ordem + 2}
          geometry={GEO_PLANO}
          material={materialDeBarra({ map: moldura, depthTest: !semProfundidade })}
        />
      )}
    </group>
  );
}
