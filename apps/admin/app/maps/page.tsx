"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listMaps, deleteMap, type MapSummary } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import { InfoMapaModal } from "./InfoMapaModal";

/**
 * Dimensões prontas para o seletor de "Novo mapa".
 *
 * 128/256/512 são potências de dois de uso comum no editor; 400×400 é o
 * tamanho real do `prt_fild08` migrado do rAthena — útil de ter como
 * referência ao lado das redondas. "Personalizada" libera os dois campos
 * numéricos para qualquer W×H.
 */
const DIMENSOES_PRONTAS = [
  { label: "128 × 128 (pequeno)", w: 128, h: 128 },
  { label: "256 × 256 (médio)", w: 256, h: 256 },
  { label: "400 × 400 (como prt_fild08)", w: 400, h: 400 },
  { label: "512 × 512 (grande)", w: 512, h: 512 },
  { label: "Personalizada…", w: 0, h: 0 },
] as const;

/** limites aceitos — abaixo disso o mapa é inútil, acima o chunk builder sofre */
const DIM_MIN = 16;
const DIM_MAX = 1024;

export default function MapsPage() {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    listMaps(page, pageSize, debounced)
      .then((res) => {
        setMaps(res.maps);
        setTotal(res.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, debounced]);

  useEffect(load, [load]);

  // id do mapa com o modal "Informações" aberto — null = fechado
  const [infoAberto, setInfoAberto] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<string | null>(null);
  async function onDelete(id: string) {
    if (!confirm(`Deletar o mapa "${id}"? Não dá pra desfazer.`)) return;
    setDeleting(id);
    try {
      await deleteMap(id);
      load();
    } catch (e) {
      setError(`Falha ao deletar ${id}: ${(e as Error).message}`);
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Mapas</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setCriando(true)}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Novo mapa 3D
          </button>
        </div>
      </div>

      {criando && (
        <NovoMapaForm
          onCancel={() => setCriando(false)}
          onCriar={(nome, w, h) => {
            // o editor de mapas é a rota id="new" — nome e dimensão vão de
            // propósito na URL: quem monta o GameMap em branco é o editor 3D
            // (game/EditorView), não esta página, e ele precisa saber o que o
            // usuário escolheu ANTES do primeiro render.
            const q = new URLSearchParams({ name: nome, w: String(w), h: String(h) });
            router.push(`/maps/new?${q.toString()}`);
          }}
        />
      )}

      <div className="mb-3 flex items-center gap-3">
        <Input placeholder="Buscar por id ou nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <span className="text-sm text-zinc-500">{total.toLocaleString("pt-BR")} mapas</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Dimensões</th>
              <th className="px-3 py-2">Água</th>
              <th className="px-3 py-2">Spawns</th>
              <th className="px-3 py-2">Props</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Carregando...</td></tr>
            ) : maps.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">Nenhum mapa</td></tr>
            ) : (
              maps.map((m) => (
                <tr key={m.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{m.id}</td>
                  <td className="px-3 py-2">{m.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.width}×{m.height}</td>
                  <td className="px-3 py-2 text-zinc-400">{m.waterLevel === null ? "—" : m.waterLevel}</td>
                  <td className="px-3 py-2">{m.spawnCount}</td>
                  <td className="px-3 py-2">{m.propCount}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      title="Editar ID, nome e tamanho — antes de abrir o editor 3D"
                      onClick={() => setInfoAberto(m.id)}
                      className="text-zinc-400 hover:underline"
                    >
                      ✎ Info
                    </button>
                    <Link href={`/maps/${encodeURIComponent(m.id)}`} className="ml-3 text-indigo-400 hover:underline">Editar</Link>
                    <button
                      onClick={() => onDelete(m.id)}
                      disabled={deleting === m.id}
                      className="ml-3 text-red-400 hover:underline disabled:opacity-50"
                    >
                      {deleting === m.id ? "Deletando…" : "Deletar"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-zinc-500">Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>
      </div>

      {infoAberto && (
        <InfoMapaModal
          id={infoAberto}
          onClose={() => setInfoAberto(null)}
          onSaved={load}
        />
      )}
    </main>
  );
}

/**
 * Nome e dimensão de um mapa novo — o pedido explícito de
 * `next-change-editor.txt`: "deixe eu conseguir escolher o nome do mapa, e a
 * área (dimensão) com select insert".
 *
 * Fica como diálogo em vez de campo na tela do editor porque a dimensão só
 * faz sentido ANTES de o mapa existir: o editor 3D já tem uma ação separada
 * para redimensionar um mapa em andamento (ver `TopBar.MapaPanel`), e squeeze
 * as duas decisões numa tela só confundiria "estou criando" com "estou
 * mudando o que já existe".
 */
function NovoMapaForm({
  onCancel,
  onCriar,
}: {
  onCancel: () => void;
  onCriar: (nome: string, largura: number, altura: number) => void;
}) {
  const [nome, setNome] = useState("");
  const [preset, setPreset] = useState<string>(DIMENSOES_PRONTAS[1]!.label);
  const [wCustom, setWCustom] = useState(256);
  const [hCustom, setHCustom] = useState(256);

  const escolhida = DIMENSOES_PRONTAS.find((d) => d.label === preset)!;
  const personalizada = escolhida.w === 0;
  const w = personalizada ? wCustom : escolhida.w;
  const h = personalizada ? hCustom : escolhida.h;
  const dimensaoValida = w >= DIM_MIN && w <= DIM_MAX && h >= DIM_MIN && h <= DIM_MAX;

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-200">Novo mapa 3D</h2>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Nome do mapa">
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Vale de Payon"
            className="w-56"
          />
        </Field>

        <Field label="Dimensão">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-56">
            {DIMENSOES_PRONTAS.map((d) => (
              <option key={d.label} value={d.label}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        {personalizada && (
          <>
            <Field label="Largura (células)">
              <Input
                type="number"
                min={DIM_MIN}
                max={DIM_MAX}
                value={wCustom}
                onChange={(e) => setWCustom(Number(e.target.value))}
                className="w-28"
              />
            </Field>
            <Field label="Altura (células)">
              <Input
                type="number"
                min={DIM_MIN}
                max={DIM_MAX}
                value={hCustom}
                onChange={(e) => setHCustom(Number(e.target.value))}
                className="w-28"
              />
            </Field>
          </>
        )}

        <Button
          disabled={!nome.trim() || !dimensaoValida}
          onClick={() => onCriar(nome.trim(), w, h)}
        >
          Criar e abrir editor
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {!dimensaoValida && personalizada && (
        <p className="mt-2 text-xs text-amber-400">
          Cada lado precisa ficar entre {DIM_MIN} e {DIM_MAX} células.
        </p>
      )}
    </div>
  );
}
