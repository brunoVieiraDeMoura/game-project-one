"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CollisionType, GameMap } from "@ragnarok/map-format";
import { updateMap } from "@/lib/api";
import { Button, Section } from "./ui";

/** Editor de mapas (soul.txt §5.9). Colisão é pintada num canvas — grids têm
 * dezenas/centenas de milhares de células, DOM não escala. Cada célula = pixel
 * colorido por tipo; pintar arrasta o pincel. Altura vem zerada do cache (só
 * o .gat do cliente tem), então isto é sobre colisão + inspeção de spawns. */

const COLORS: Record<CollisionType, string> = {
  walkable: "#3f6212", // verde
  wall: "#3f3f46", // cinza
  water: "#1e40af", // azul
  cliff: "#78350f", // marrom
};
const TYPES: CollisionType[] = ["walkable", "wall", "water", "cliff"];
const MAX_CANVAS = 640; // px máximos no maior lado

export function MapEditor({ initial }: { initial: GameMap }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // colisão mutável mantida num ref (evita re-render por célula); versão só pra re-desenhar
  const collisionRef = useRef<CollisionType[]>([...initial.collision]);
  const [brush, setBrush] = useState<CollisionType>("wall");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const painting = useRef(false);

  const { width, height } = initial.size;
  const scale = Math.max(1, Math.floor(MAX_CANVAS / Math.max(width, height)));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const collision = collisionRef.current;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ctx.fillStyle = COLORS[collision[y * width + x]!];
        // y invertido: linha 0 do gat é o "sul"; desenhar de baixo pra cima deixa o norte em cima
        ctx.fillRect(x * scale, (height - 1 - y) * scale, scale, scale);
      }
    }
  }, [width, height, scale]);

  useEffect(draw, [draw]);

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = Math.floor(((clientX - rect.left) / rect.width) * width);
      const pyTop = Math.floor(((clientY - rect.top) / rect.height) * height);
      const py = height - 1 - pyTop; // desfaz a inversão do desenho
      if (px < 0 || px >= width || py < 0 || py >= height) return;
      const idx = py * width + px;
      if (collisionRef.current[idx] === brush) return;
      collisionRef.current[idx] = brush;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = COLORS[brush];
        ctx.fillRect(px * scale, pyTop * scale, scale, scale);
      }
      setDirty(true);
    },
    [brush, width, height, scale],
  );

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next: GameMap = { ...initial, collision: collisionRef.current };
      await updateMap(initial.id, next);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {saved && <p className="rounded bg-emerald-950 px-3 py-2 text-sm text-emerald-300">Colisão salva.</p>}

      <Section title={`Colisão — ${width}×${height} células`}>
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-zinc-500">Pincel:</span>
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setBrush(t)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                brush === t ? "ring-2 ring-indigo-500" : "ring-1 ring-zinc-700"
              }`}
            >
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: COLORS[t] }} />
              {t}
            </button>
          ))}
        </div>
        <div className="overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
          <canvas
            ref={canvasRef}
            width={width * scale}
            height={height * scale}
            className="cursor-crosshair"
            style={{ imageRendering: "pixelated", maxWidth: "100%" }}
            onMouseDown={(e) => {
              painting.current = true;
              paintAt(e.clientX, e.clientY);
            }}
            onMouseMove={(e) => {
              if (painting.current) paintAt(e.clientX, e.clientY);
            }}
            onMouseUp={() => (painting.current = false)}
            onMouseLeave={() => (painting.current = false)}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Norte no topo. Altura vem zerada (o cache do rAthena não guarda relevo — só o .gat do cliente).
        </p>
      </Section>

      <Section title={`Spawns (${initial.spawns.length}) — somente leitura`}>
        {initial.spawns.length === 0 ? (
          <p className="text-xs text-zinc-500">Nenhum spawn.</p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="py-1">Tipo</th>
                  <th className="py-1">Ref</th>
                  <th className="py-1">Posição</th>
                  <th className="py-1">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {initial.spawns.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-800/50 text-zinc-400">
                    <td className="py-1">{s.kind}</td>
                    <td className="py-1 font-mono">{s.refId ?? "—"}</td>
                    <td className="py-1">{s.position[0]},{s.position[2]}</td>
                    <td className="py-1">
                      {s.kind === "mob"
                        ? `×${s.count} raio ${s.radius}`
                        : s.kind === "warp"
                          ? `→ ${s.target?.mapId} ${s.target?.position[0]},${s.target?.position[2]}`
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/maps")}>Voltar</Button>
        <Button onClick={onSave} disabled={saving || !dirty}>
          {saving ? "Salvando..." : dirty ? "Salvar colisão" : "Sem alterações"}
        </Button>
      </div>
    </div>
  );
}
