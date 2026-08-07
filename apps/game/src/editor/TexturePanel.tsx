import { useEffect, useState } from "react";
import type { SurfaceType } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { ESCALA_PADRAO, escalaDe, manifestoTerreno, varianteDe, varianteDeAgua, type VarianteTextura } from "../grid/terrainTextures";
import { ink } from "../ui/rpg";

/**
 * Qual textura cada superfície usa NESTE mapa, e em que tamanho.
 *
 * Duas perguntas que só quem autora o mapa responde:
 *
 * • **qual** — "pedra" pode ser rocha áspera, matacão rachado ou alvenaria, e a
 *   escolha muda de mapa para mapa. As opções saem do `manifest.json` que o
 *   `terrain:textures` gera, então acrescentar uma textura ao acervo já a faz
 *   aparecer aqui, sem tocar em código;
 * • **de que tamanho** — a textura ladrilha por coordenada de mundo, e o número
 *   é em UNIDADES (a célula do rAthena mede 2). Pequena demais e o padrão vira
 *   granulado que, na distância de câmera do jogo, lê como cor sólida; grande
 *   demais e a mancha fica maior que o terreno que ela cobre.
 *
 * A mudança aparece na hora: trocar a variante recarrega só aquela camada do
 * array texture, e a escala é um uniform.
 */

const SUPERFICIES: { key: SurfaceType; label: string }[] = [
  { key: "grass", label: "Grama" },
  { key: "dirt", label: "Terra" },
  { key: "stone", label: "Pedra" },
  { key: "sand", label: "Areia" },
  { key: "snow", label: "Neve" },
  { key: "water", label: "Água (lago e rio)" },
];

const lbl = { font: "10px system-ui", color: ink.faint } as const;

export function TexturePanel() {
  const map = useEditorStore((s) => s.map);
  const setTerrainStyle = useEditorStore((s) => s.setTerrainStyle);
  const [catalogo, setCatalogo] = useState<Partial<Record<SurfaceType, VarianteTextura[]>>>({});

  useEffect(() => {
    let vivo = true;
    void manifestoTerreno().then((m) => {
      if (vivo) setCatalogo(m.superficies);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!map) return null;
  const estilo = map.terrainStyle;

  return (
    <>
      <p style={{ font: "9px system-ui", color: ink.faint, margin: "0 0 8px" }}>
        Só aparência: nada aqui muda colisão nem passagem, e o mapa exportado para o servidor
        continua igual.
      </p>
      {SUPERFICIES.map(({ key, label }) => {
        const opcoes = catalogo[key] ?? [];
        // a água não é camada do array texture; a variante dela tem regra própria
        const atual = key === "water" ? varianteDeAgua(estilo) : varianteDe(key as "grass", estilo);
        const escala = escalaDe(key, estilo);
        return (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <img
                src={`/assets/terrain/thumb/${atual}.png`}
                alt=""
                width={26}
                height={26}
                style={{ borderRadius: 4, border: `1px solid ${ink.border}`, display: "block" }}
              />
              <span style={{ font: "600 11px system-ui", color: ink.text }}>{label}</span>
            </div>
            <select
              value={atual}
              aria-label={`Textura de ${label}`}
              onChange={(e) => setTerrainStyle(key, { texture: e.target.value })}
              disabled={opcoes.length === 0}
              style={{
                width: "100%",
                background: ink.slot,
                border: `1px solid ${ink.border}`,
                borderRadius: 6,
                color: ink.text,
                font: "11px system-ui",
                padding: "4px 6px",
                marginBottom: 4,
              }}
            >
              {opcoes.length === 0 && <option>(sem manifesto — rode terrain:textures)</option>}
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={lbl}>
                Tamanho <b style={{ color: ink.text }}>{escala.toFixed(0)}</b> un
                <span style={{ opacity: 0.7 }}> ({(escala / 2).toFixed(0)} células)</span>
              </span>
              <input
                type="range"
                min={4}
                max={64}
                step={1}
                value={escala}
                title="Unidades de mundo por repetição da textura. Aumente se o chão parecer cor sólida."
                aria-label={`Tamanho da textura de ${label}`}
                onChange={(e) => setTerrainStyle(key, { scale: Number(e.target.value) })}
                style={{ marginLeft: "auto", width: 100 }}
              />
              <button
                type="button"
                title="Volta ao tamanho padrão desta superfície"
                aria-label={`Volta o tamanho de ${label} ao padrão`}
                onClick={() => setTerrainStyle(key, { scale: ESCALA_PADRAO[key] })}
                style={{
                  padding: "1px 6px",
                  borderRadius: 5,
                  border: `1px solid ${ink.border}`,
                  background: "rgba(255,255,255,0.06)",
                  color: ink.text,
                  font: "11px system-ui",
                  cursor: "pointer",
                }}
              >
                ↺
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
