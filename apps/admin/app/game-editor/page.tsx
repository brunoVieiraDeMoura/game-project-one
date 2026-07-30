"use client";

import { useEffect, useState } from "react";
import { ServerConfigSchema, type GameplayConfig, type ServerConfig } from "@ragnarok/game-data";
import { getServerConfig, updateServerConfig } from "@/lib/api";
import { Button, Input, Section } from "@/components/ui";

/**
 * Editor do game: ajusta os parâmetros do cliente 3D. Vive dentro do
 * server_config (bloco gameplay); o game (localhost:3001/play) lê via API e
 * aplica. Salvar preserva o resto do server_config.
 *
 * Todo campo numérico declara MIN/MAX iguais aos do schema zod. Sem isso o
 * usuário digitava um valor que a API recusava (400) — ou pior, um valor que
 * passava e quebrava a cena (um `0` em cameraDistance, um vazio virando NaN em
 * pixelSize e deixando a tela preta). Onde os valores úteis são poucos e
 * discretos, o campo é um SELECT: não dá pra errar.
 */

type Option = { value: string; label: string };
type Field = {
  key: keyof GameplayConfig;
  label: string;
  hint?: string;
  kind?: "number" | "color" | "select" | "toggle";
  step?: number;
  /** limites do schema — o input clampa e o save valida */
  min?: number;
  max?: number;
  options?: Option[];
  /** select cujo valor é número (converte na hora de gravar) */
  numeric?: boolean;
};
type Group = { title: string; fields: Field[] };

/** monta opções numéricas prontas pra um select */
const nums = (values: number[], suffix = ""): Option[] =>
  values.map((v) => ({ value: String(v), label: `${v}${suffix}` }));

const GROUPS: Group[] = [
  {
    title: "Mundo hex",
    fields: [
      {
        key: "hexScale",
        label: "Tamanho do bloco hexagonal",
        kind: "select",
        numeric: true,
        hint: "1 = nativo. Multiplica o mundo inteiro (posições, altura dos degraus, câmera, névoa)",
        options: nums([0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12], "×"),
      },
    ],
  },
  {
    // Pós-processamento: não muda asset nenhum, é filtro na imagem final.
    // Ver apps/game/src/scene/RetroFilter.tsx.
    title: "Filtro retrô",
    fields: [
      {
        key: "retroMode",
        label: "Modo",
        kind: "select",
        hint: "a paleta vem do modo — 16 bits = RGB565, 8 bits = RGB332 (256 cores)",
        options: [
          { value: "off", label: "Desligado" },
          { value: "pixel", label: "Só pixelização (cores originais)" },
          { value: "16bit", label: "16 bits (RGB565)" },
          { value: "8bit", label: "8 bits (RGB332 — bem chapado)" },
        ],
      },
      {
        key: "retroPixelSize",
        label: "Tamanho do pixel",
        kind: "select",
        numeric: true,
        hint: "quanto maior, mais grosso o quadradinho",
        options: [
          { value: "2", label: "2 — sutil" },
          { value: "4", label: "4" },
          { value: "6", label: "6 — padrão" },
          { value: "8", label: "8" },
          { value: "12", label: "12 — bem grosso" },
          { value: "16", label: "16" },
          { value: "24", label: "24 — máximo" },
        ],
      },
      { key: "retroDither", label: "Dithering (Bayer 4×4)", kind: "toggle", hint: "tira o faixamento do céu e da névoa" },
    ],
  },
  {
    title: "Chão (grama)",
    fields: [
      {
        key: "groundMode",
        label: "Visual do chão",
        kind: "select",
        hint: "original = KayKit · cor = chapada · textura = com padrão procedural",
        options: [
          { value: "atlas", label: "Original (KayKit)" },
          { value: "color", label: "Cor sólida" },
          { value: "texture", label: "Textura procedural" },
        ],
      },
      { key: "groundColor", label: "Cor da grama", kind: "color", hint: "usada nos modos cor e textura" },
      { key: "groundTextureScale", label: "Tamanho do padrão", step: 0.5, min: 0.5, max: 20, hint: "unidades de mundo por repetição" },
      { key: "groundTextureStrength", label: "Intensidade do padrão", step: 0.05, min: 0, max: 1, hint: "0 = liso · 1 = bem marcado" },
    ],
  },
  {
    title: "Personagem",
    fields: [
      { key: "moveSpeed", label: "Velocidade de movimento", step: 1, min: 1, max: 100, hint: "unidades/seg — vale pro clique-tile e pro WASD" },
      { key: "charScale", label: "Tamanho do personagem", step: 0.02, min: 0.05, max: 40, hint: "~0.34 = 1/4 do hex nativo. Suba junto com o tamanho do bloco" },
      {
        key: "animationSpeed",
        label: "Velocidade das animações",
        kind: "select",
        numeric: true,
        hint: "1 = normal",
        options: nums([0.5, 0.75, 1, 1.25, 1.5, 2, 3], "×"),
      },
    ],
  },
  {
    title: "Pulo e física",
    fields: [
      { key: "jumpHeight", label: "Tamanho do pulo", step: 0.1, min: 0.1, max: 20, hint: "altura, em unidades de hexágono" },
      { key: "gravity", label: "Velocidade da queda", step: 1, min: 1, max: 100, hint: "maior = cai mais rápido" },
    ],
  },
  {
    title: "Câmera",
    fields: [
      { key: "cameraDistance", label: "Distância da câmera", step: 1, min: 1, max: 200, hint: "raio do follow (o jogo respeita um mínimo pra não entrar no terreno)" },
      {
        key: "cameraMaxZoom",
        label: "Zoom máximo (scroll)",
        kind: "select",
        numeric: true,
        hint: "multiplicador da distância base",
        options: nums([2, 3, 4, 5, 7, 10, 15], "×"),
      },
      { key: "cameraRotateSpeed", label: "Sensibilidade da rotação", step: 0.001, min: 0.001, max: 0.05 },
    ],
  },
  {
    title: "Renderização & Névoa",
    fields: [
      { key: "renderDistance", label: "Distância de renderização", step: 5, min: 10, max: 1000, hint: "raio — mantenha maior que o fim da névoa" },
      { key: "fogNear", label: "Névoa — início", step: 2, min: 0, max: 1000, hint: "onde começa a desbotar" },
      { key: "fogFar", label: "Névoa — fim (opaco)", step: 2, min: 1, max: 2000, hint: "menor = névoa mais perto" },
    ],
  },
];

const clamp = (v: number, f: Field) => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, v));

/** campos numéricos fora do range — o save fica bloqueado enquanto houver algum */
function invalidFields(g: GameplayConfig): Field[] {
  const bad: Field[] = [];
  for (const group of GROUPS)
    for (const f of group.fields) {
      if (f.kind === "toggle" || f.kind === "color" || f.kind === "select") continue;
      const v = Number(g[f.key]);
      if (!Number.isFinite(v) || v < (f.min ?? -Infinity) || v > (f.max ?? Infinity)) bad.push(f);
    }
  return bad;
}

export default function GameEditorPage() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getServerConfig()
      // passa pelo schema: uma API antiga (ou uma linha de server_config salva
      // antes de um campo existir) devolve o bloco incompleto, e aí o input
      // numérico recebia `undefined` → "Received NaN for the value attribute".
      .then((cfg) => setConfig(ServerConfigSchema.parse(cfg)))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error && !config)
    return (
      <main className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>
      </main>
    );
  if (!config)
    return (
      <main className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <p className="text-zinc-500">Carregando...</p>
      </main>
    );

  const g = config.gameplay;
  const setG = (key: keyof GameplayConfig, value: number | string | boolean) =>
    setConfig({ ...config, gameplay: { ...g, [key]: value } });
  const invalid = invalidFields(g);

  async function onSave() {
    if (!config || invalid.length > 0) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { version: _v, updatedAt: _u, ...rest } = config;
      const next = await updateServerConfig(rest);
      setConfig(ServerConfigSchema.parse(next));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl p-4 pb-24 sm:p-6 sm:pb-6">
      {/* cabeçalho: empilha no celular, lado a lado a partir de sm */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold sm:text-xl">Editor do game</h1>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
            ajustes do cliente 3D (localhost:3001/play) · versão {config.version}
          </p>
        </div>
        {/* no celular o botão vira barra fixa no rodapé (fica sempre alcançável) */}
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button onClick={onSave} disabled={saving || invalid.length > 0} className="w-full sm:w-auto">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {saved && <p className="mb-3 rounded bg-emerald-950 px-3 py-2 text-sm text-emerald-300">Salvo — recarregue o /play pra aplicar.</p>}
      {invalid.length > 0 && (
        <p className="mb-3 rounded bg-amber-950 px-3 py-2 text-sm text-amber-300">
          Fora do intervalo: {invalid.map((f) => f.label).join(", ")}. Corrija pra poder salvar.
        </p>
      )}

      <div className="space-y-4">
        {GROUPS.map((group) => (
          <Section key={group.title} title={group.title}>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {group.fields.map((f) => (
                <FieldRow key={f.key} field={f} value={g[f.key]} onChange={(v) => setG(f.key, v)} />
              ))}
            </div>
          </Section>
        ))}
      </div>
    </main>
  );
}

/** uma linha do formulário: rótulo, controle e a dica embaixo (não no rótulo —
 * concatenada ela estourava a largura e quebrava o alinhamento das colunas) */
function FieldRow({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: GameplayConfig[keyof GameplayConfig];
  onChange: (v: number | string | boolean) => void;
}) {
  const num = Number(value);
  const fora = f.kind !== "toggle" && f.kind !== "color" && f.kind !== "select" && (!Number.isFinite(num) || num < (f.min ?? -Infinity) || num > (f.max ?? Infinity));
  const faixa = f.min != null && f.max != null ? `${f.min}–${f.max}` : null;

  return (
    <div className="min-w-0">
      <label className="mb-1 flex items-baseline gap-2 text-xs font-medium text-zinc-400">
        <span className="truncate">{f.label}</span>
        {faixa && <span className="shrink-0 text-[10px] text-zinc-600">{faixa}</span>}
      </label>

      {f.kind === "toggle" ? (
        <label className="flex items-center gap-2 py-1.5 text-sm text-zinc-200">
          <input type="checkbox" className="size-4 accent-indigo-500" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {value ? "Ligado" : "Desligado"}
        </label>
      ) : f.kind === "select" ? (
        <select
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          value={String(value)}
          onChange={(e) => onChange(f.numeric ? Number(e.target.value) : e.target.value)}
        >
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === "color" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-9 w-12 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-900"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
          <Input value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      ) : (
        <Input
          type="number"
          step={f.step}
          min={f.min}
          max={f.max}
          // nunca deixa NaN chegar no DOM (React avisa e o campo trava)
          value={Number.isFinite(num) ? num : ""}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          // ao sair do campo, traz pro intervalo — em vez de deixar um valor que
          // a API recusaria com 400
          onBlur={(e) => onChange(clamp(Number(e.target.value) || (f.min ?? 0), f))}
          className={fora ? "border-amber-600" : ""}
        />
      )}

      {f.hint && <p className="mt-1 text-[11px] leading-snug text-zinc-600">{f.hint}</p>}
    </div>
  );
}
