import { CharacterPortrait } from "../hud/CharacterPortrait";
import type { WeaponMount } from "../assets";

/** TEMP: escolha visual do ângulo do arco. Remover depois de decidir. */
const PI = Math.PI;
const CANDIDATOS: { label: string; rot: [number, number, number] }[] = [
  // pedido: base "rotX 90", só que virado de cabeça pra baixo — as 3 formas
  // de "virar verticalmente" a partir dele (flip em cada eixo)
  { label: "rotX 90 (original)", rot: [PI / 2, 0, 0] },
  { label: "rotX 90 + flipZ180", rot: [PI / 2, 0, PI] },
  { label: "rotX 90 + flipY180", rot: [PI / 2, PI, 0] },
  { label: "rotX -90 (flipX180)", rot: [-PI / 2, 0, 0] },
];

export function ClassPreviewView() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0d12", display: "flex", flexWrap: "wrap", gap: 8, padding: 8, overflow: "auto" }}>
      {CANDIDATOS.map((c) => {
        const weapons: WeaponMount[] = [{ weapon: "bow", slot: "handslotl", rotation: c.rot }];
        return (
          <div key={c.label} style={{ width: 220, height: 300, position: "relative", border: "1px solid #333", flex: "0 0 auto" }}>
            <div style={{ position: "absolute", top: 4, left: 4, zIndex: 1, color: "#fff", font: "12px system-ui", background: "rgba(0,0,0,0.5)", padding: "2px 4px" }}>
              {c.label}
            </div>
            <CharacterPortrait dono={`preview-${c.label}`} characterKey="rogue" weapons={weapons} inteiro fundo={false} />
          </div>
        );
      })}
    </div>
  );
}
