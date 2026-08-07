"use client";

import { useEffect, useState } from "react";
import type { GameMap } from "@ragnarok/map-format";
import { objetosForaDosLimites, resizeGameMap } from "@ragnarok/map-format";
import { getMap, updateMap } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

/** mesmos limites do `NovoMapaForm` desta página — um mapa editado tem que
 * caber nas mesmas regras de um mapa criado */
const DIM_MIN = 16;
const DIM_MAX = 1024;

/**
 * Editor de informações do mapa: ID, nome, largura, altura — ANTES de abrir o
 * editor 3D (pedido do leia1.txt). Botão "✎ Info" próprio na tabela, separado
 * do "Editar" que já abre o iframe direto — ninguém que só quer editar o mapa
 * em si precisa passar por aqui.
 *
 * Redimensionar usa `resizeGameMap`/`objetosForaDosLimites` de
 * `@ragnarok/map-format` — a MESMA função que `editorStore.ts` usa no editor
 * 3D, então "quantos objetos ficam fora" nunca diverge entre as duas telas
 * pro mesmo resize.
 *
 * ID duplicado: não existe rota de "checar disponibilidade" no backend, e
 * criar uma só pra isto seria uma corrida contra o próprio save (checado
 * livre, mas ocupado um instante depois). O `PUT /maps/:id` já valida (409
 * quando o novo id colide) — é o único lugar que precisa validar de verdade,
 * então o erro aparece ali, claro, em vez de uma checagem paralela que pode
 * ficar desatualizada.
 */
export function InfoMapaModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [mapa, setMapa] = useState<GameMap | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [novoId, setNovoId] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [largura, setLargura] = useState(0);
  const [altura, setAltura] = useState(0);

  // confirmação de encolher: só pede uma vez, some se o usuário mudar o
  // tamanho de novo (o aviso vale para O TAMANHO que estava na tela)
  const [avisoConfirmado, setAvisoConfirmado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    getMap(id)
      .then((m) => {
        if (!vivo) return;
        setMapa(m);
        setNovoId(m.id);
        setNovoNome(m.name);
        setLargura(m.size.width);
        setAltura(m.size.height);
        setErro(null);
      })
      .catch((e: Error) => vivo && setErro(`Falha ao carregar: ${e.message}`))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id]);

  useEffect(() => setAvisoConfirmado(false), [largura, altura]);

  const idValido = novoId.trim().length > 0;
  const nomeValido = novoNome.trim().length > 0;
  const tamanhoValido = largura >= DIM_MIN && largura <= DIM_MAX && altura >= DIM_MIN && altura <= DIM_MAX;
  const mudouTamanho = !!mapa && (largura !== mapa.size.width || altura !== mapa.size.height);

  const foraDosLimites = mapa && mudouTamanho ? objetosForaDosLimites(mapa, largura, altura) : null;
  const totalFora = foraDosLimites ? foraDosLimites.props.length + foraDosLimites.spawns.length + foraDosLimites.triggers.length : 0;
  const precisaConfirmar = totalFora > 0 && !avisoConfirmado;

  async function salvar() {
    if (!mapa || !idValido || !nomeValido || !tamanhoValido) return;
    if (precisaConfirmar) {
      setAvisoConfirmado(true); // 1º clique arma; o botão vira "Salvar mesmo assim"
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const redimensionado = mudouTamanho ? resizeGameMap(mapa, largura, altura).map : mapa;
      const final: GameMap = { ...redimensionado, id: novoId.trim(), name: novoNome.trim() };
      await updateMap(id, final);
      onSaved();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setErro(msg.includes("409") ? `O ID "${novoId.trim()}" já está em uso — escolha outro.` : `Falha ao salvar: ${msg}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar informações do mapa"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-925 p-5" style={{ backgroundColor: "#101014" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Informações do mapa</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            ✕
          </button>
        </div>

        {carregando ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : !mapa ? (
          <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{erro ?? "Mapa não encontrado."}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="ID do mapa">
              <Input value={novoId} onChange={(e) => setNovoId(e.target.value)} />
              {!idValido && <p className="mt-1 text-xs text-amber-400">O ID não pode ficar vazio.</p>}
            </Field>
            <Field label="Nome">
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
              {!nomeValido && <p className="mt-1 text-xs text-amber-400">O nome não pode ficar vazio.</p>}
            </Field>
            <div className="flex gap-3">
              <Field label="Largura (células)" className="flex-1">
                <Input type="number" min={DIM_MIN} max={DIM_MAX} value={largura} onChange={(e) => setLargura(Number(e.target.value))} />
              </Field>
              <Field label="Altura (células)" className="flex-1">
                <Input type="number" min={DIM_MIN} max={DIM_MAX} value={altura} onChange={(e) => setAltura(Number(e.target.value))} />
              </Field>
            </div>
            {!tamanhoValido && (
              <p className="text-xs text-amber-400">Cada lado precisa ficar entre {DIM_MIN} e {DIM_MAX} células.</p>
            )}

            {mudouTamanho && tamanhoValido && (
              <p className="text-xs text-zinc-500">
                {largura > mapa.size.width || altura > mapa.size.height
                  ? "Crescer preenche o espaço novo com chão plano — nada existente é tocado."
                  : "Encolher preserva o canto superior-esquerdo do mapa; o resto do relevo, colisão e superfície fora da nova grade é perdido."}
              </p>
            )}

            {totalFora > 0 && (
              <div className="rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                <p className="font-semibold">
                  {totalFora} objeto{totalFora !== 1 ? "s" : ""} ficará{totalFora !== 1 ? "ão" : ""} fora dos novos limites:
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {foraDosLimites!.props.length > 0 && <li>{foraDosLimites!.props.length} prop{foraDosLimites!.props.length !== 1 ? "s" : ""}</li>}
                  {foraDosLimites!.spawns.length > 0 && <li>{foraDosLimites!.spawns.length} spawn{foraDosLimites!.spawns.length !== 1 ? "s" : ""}</li>}
                  {foraDosLimites!.triggers.length > 0 && <li>{foraDosLimites!.triggers.length} gatilho{foraDosLimites!.triggers.length !== 1 ? "s" : ""}</li>}
                </ul>
                <p className="mt-1">Nada é apagado — eles continuam salvos, só fora da área visível até o mapa crescer de novo ou serem movidos.</p>
              </div>
            )}

            {erro && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{erro}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button
                variant={precisaConfirmar ? "danger" : "default"}
                onClick={salvar}
                disabled={salvando || !idValido || !nomeValido || !tamanhoValido}
              >
                {salvando ? "Salvando…" : precisaConfirmar ? "Salvar mesmo assim" : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
