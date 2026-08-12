import { CharacterPortrait } from "../hud/CharacterPortrait";
import type { WeaponMount } from "../assets";

/**
 * TEMP: teste isolado do Espadachim novo (rig Mixamo, leia1.txt) sem passar
 * por login/char-select — pra calibrar a `rotation` da espada em
 * `mixamorigRightHand` (`entities/classModels.ts`, hoje identidade).
 * Arraste pra girar. Remover depois de calibrar/decidir.
 */
const CANDIDATOS: { label: string; rot: [number, number, number] }[] = [
  { label: "identidade (atual)", rot: [0, 0, 0] },
  { label: "rotX 90", rot: [Math.PI / 2, 0, 0] },
  { label: "rotZ 90", rot: [0, 0, Math.PI / 2] },
  { label: "rotX 90 + rotZ 90", rot: [Math.PI / 2, 0, Math.PI / 2] },
];

export function ClassPreviewView() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0d12", display: "flex", flexWrap: "wrap", gap: 8, padding: 8, overflow: "auto" }}>
      {CANDIDATOS.map((c) => {
        const weapons: WeaponMount[] = [{ weapon: "sword_2handed", slot: "mixamorigRightHand", rotation: c.rot }];
        return (
          <div key={c.label} style={{ width: 220, height: 300, position: "relative", border: "1px solid #333", flex: "0 0 auto" }}>
            <div style={{ position: "absolute", top: 4, left: 4, zIndex: 1, color: "#fff", font: "12px system-ui", background: "rgba(0,0,0,0.5)", padding: "2px 4px" }}>
              {c.label}
            </div>
            <CharacterPortrait dono={`preview-${c.label}`} characterKey="knight_mixamo" weapons={weapons} inteiro fundo={false} giravel />
          </div>
        );
      })}
    </div>
  );
}
