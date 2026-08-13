import { useEffect } from "react";
import { Html } from "@react-three/drei";
import type { GameMap } from "@ragnarok/map-format";
import { cellToWorld, type LegacyMapping } from "./legacyCells";
import { useDamageFeed, type NetDamage } from "./damageFeed";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { useDamageNumberStyles } from "../vfx/damageNumberStyle";

/**
 * Números/mensagens de dano do servidor, desenhados em cima de quem apanhou.
 *
 * A posição é lida uma vez, no momento em que o número nasce: ele fica parado
 * no ar enquanto sobe, como no RO — seguir o alvo faria o número correr junto
 * com o mob. Por isso não precisa de `useFrame`/grupo rastreado (ao contrário
 * de `vfx/mage/cold-bolt/ColdBoltImpact`, que segue um alvo em queda) — só um
 * `<group position>` estático.
 *
 * DOM/CSS (`<Html>`), não `<Billboard><Text>` (troika-three-text): mesma
 * tipografia de TODO hit/skill do jogo (`vfx/damageNumberStyle`, o mesmo
 * vocabulário visual do Cold Bolt) e — de graça, por não fazer teste de
 * profundidade contra a cena — sempre na camada da FRENTE do personagem,
 * nunca escondido atrás da própria cabeça/chapéu (pedido: "miss e sem flecha
 * devem ficar acima do personagem na layer a frente dele também").
 */
export function NetDamageNumbers({ map, mapping }: { map: GameMap; mapping: LegacyMapping }) {
  useDamageNumberStyles();
  const numbers = useDamageFeed((s) => s.numbers);
  return (
    <>
      {numbers.map((n) => (
        <FloatingNumber key={n.id} n={n} map={map} mapping={mapping} />
      ))}
    </>
  );
}

function FloatingNumber({ n, map, mapping }: { n: NetDamage; map: GameMap; mapping: LegacyMapping }) {
  const clear = useDamageFeed((s) => s.clear);

  useEffect(() => {
    const t = setTimeout(() => clear(n.id), 900);
    return () => clearTimeout(t);
  }, [n.id, clear]);

  const world = useWorldStore.getState();
  const source = n.onSelf ? world.self : world.entities[n.gid];
  if (!source) return null;

  const cell = interpolatedCell(source, performance.now());
  const pos = cellToWorld(map, mapping, cell.x, cell.y);

  // prioridade crítico > skill > básico > (miss/aviso é texto, cor própria)
  const cls = n.text ? "dmg-num--warn" : n.crit ? "dmg-num--crit" : n.skill ? "dmg-num--skill" : "dmg-num--hit";
  const label = n.text ?? (n.miss ? "Miss" : String(n.value));

  // dano de SKILL sempre acima da cabeça — mesma referência de altura do
  // total amarelo do Cold Bolt (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD em
  // vfx/mage/cold-bolt/ColdBoltImpact); ataque básico continua na altura de
  // sempre (peito), que é onde o golpe corpo-a-corpo realmente acontece.
  const height = n.skill ? 2.2 : 1.6;

  return (
    <group position={[pos.x + (n.id % 2 ? 0.3 : -0.3), pos.y + height, pos.z]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} pointerEvents="none">
        <div className={`dmg-num ${cls}`}>{label}</div>
      </Html>
    </group>
  );
}
