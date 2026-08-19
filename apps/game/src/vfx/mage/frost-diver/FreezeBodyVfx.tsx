import { useEffect, useRef } from "react";
import { useWorldStore } from "../../../net/worldStore";
import { OPT1_FREEZE } from "../../../net/entityOption";
import { vfxManager } from "../../core/manager";
import { FREEZE_BODY_GPU_ID, FREEZE_SHATTER_GPU_ID } from "./freezeBodyVfxDefGpu";
import type { VfxHandle } from "../../core/types";

/**
 * VFX PERSISTENTE de Congelar (MG_FROSTDIVER) — GPU (migrado da auditoria
 * "fechar o arco de VFX", 2026-08-19; DOM/`<Html>` original em `git log`
 * deste arquivo, ver `freezeBodyVfxDefGpu.tsx` pro porquê da receita).
 *
 * Fonte da verdade continua SEMPRE o `opt1` real do servidor
 * (`net/worldStore.entities[gid].opt1`, via `entity:option`/ZC_STATE_CHANGE)
 * — nunca um timer local. Mesmo princípio que Petrificar usa
 * (`net/NetEntity.tsx: usePetrifyMaterial`).
 *
 * Padrão NOVO nesta base (primeiro VFX Core dirigido por STATUS de
 * entidade, não por `skill:cast`): este componente não desenha nada
 * (`return null`) — só espelha `frozen` num `vfxManager.play()`/`stop()`
 * imperativo, guardando o `VfxHandle` num ref. `anchor:"entity"` do Core
 * já resolve a posição/escala reais a cada quadro a partir do `targetGid`
 * — não precisa mais de `<group position>` local nem de `targetScale`
 * como prop (o Core já lê o catálogo de modelo sozinho,
 * `anchor.ts: entityVisualScale`).
 */
export function FreezeBodyVfx({ gid }: { gid: number }) {
  const opt1 = useWorldStore((s) => s.entities[gid]?.opt1);
  const frozen = opt1 === OPT1_FREEZE;
  const handleRef = useRef<VfxHandle | null>(null);

  useEffect(() => {
    if (frozen && !handleRef.current) {
      handleRef.current = vfxManager.play(FREEZE_BODY_GPU_ID, { targetGid: gid }) ?? null;
    } else if (!frozen && handleRef.current) {
      vfxManager.stop(handleRef.current, "unfreeze");
      handleRef.current = null;
      // burst de "estilhaçar" — um disparo só, substitui a animação
      // `fbvShardGone*` de saída da versão DOM.
      vfxManager.play(FREEZE_SHATTER_GPU_ID, { targetGid: gid });
    }
  }, [frozen, gid]);

  // entidade desmontou (morreu/saiu de vista) com o efeito ainda de pé —
  // nunca deixar uma instância persistente órfã no manager.
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        vfxManager.stop(handleRef.current, "unmount");
        handleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
