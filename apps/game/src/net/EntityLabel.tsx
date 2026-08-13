import { Billboard, Text } from "@react-three/drei";
import { WorldBar } from "./WorldBar";

/**
 * Plaquinha em cima da entidade: nome (e HP, quando o servidor manda).
 *
 * O nome vem do próprio rAthena (`ACK_REQNAME`), e com `show_mob_info` ligado
 * ele já chega no formato do RO — "Poring" vira algo como
 * `Poring 55/55 Lv 1`. A barra abaixo do nome só aparece quando existe HP:
 * inventar uma barra cheia para um mob cujo HP o servidor não mandou seria
 * mentira.
 *
 * A barra usa a MESMA moldura pintada das barras de HP/SP do HUD, montada em
 * textura por `ui/barTexture.ts` — no mundo 3D não existe `border-image`.
 */

/**
 * Medidas da plaquinha, em frações de CÉLULA.
 *
 * Tudo se mede na célula e não em unidades de mundo, senão a plaquinha muda de
 * tamanho a cada `hexScale` — a mesma regra do VFX.
 *
 * A barra ENGORDOU (0,05 → 0,085 de célula) porque a moldura pintada tem traço
 * e canto: no fio de antes ela virava uma linha só e o desenho não aparecia. O
 * nome subiu junto (0,10 → 0,115), senão ficava miúdo ao lado dela.
 */
const PLACA = {
  // "mesma tipografia" do dano (vfx/damageNumberStyle): fonte bold + contorno
  // mais grosso + leve blur (glow). Tamanho subiu um pouco junto (pedido).
  nome: 0.14,
  contorno: 0.015,
  barraW: 0.62,
  barraH: 0.085,
  /** altura acima do topo do modelo */
  acima: 0.35,
} as const;

export function EntityLabel({
  name,
  level,
  hp,
  maxHp,
  height,
  cellSize,
  targeted,
}: {
  name: string;
  level?: number | undefined;
  hp?: number | undefined;
  maxHp?: number | undefined;
  /** altura do modelo em unidades de mundo (a plaquinha fica logo acima) */
  height: number;
  /** largura de uma célula — a plaquinha é medida nela, como o resto da cena */
  cellSize: number;
  targeted?: boolean;
}) {
  const hasHp = hp !== undefined && maxHp !== undefined && maxHp > 0;
  const frac = hasHp ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const width = cellSize * PLACA.barraW;
  const barHeight = cellSize * PLACA.barraH;

  return (
    <Billboard position={[0, height + cellSize * PLACA.acima, 0]}>
      <Text
        fontSize={cellSize * PLACA.nome}
        fontWeight="bold"
        color={targeted ? "#ffd166" : "#ffffff"}
        outlineWidth={cellSize * PLACA.contorno}
        outlineColor="#000000"
        outlineBlur={cellSize * 0.012}
        anchorX="center"
        anchorY="bottom"
      >
        {level ? `${name}  Lv ${level}` : name}
      </Text>

      {hasHp && (
        <group position={[0, -barHeight * 1.5, 0]}>
          {/* vermelho do alvo: o tom médio da curva de `ENEMY_FILL` do HUD */}
          <WorldBar width={width} height={barHeight} frac={frac} color="#8a2f22" />
        </group>
      )}
    </Billboard>
  );
}
