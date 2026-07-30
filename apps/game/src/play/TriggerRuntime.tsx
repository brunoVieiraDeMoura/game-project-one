import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap, MapTrigger } from "@ragnarok/map-format";
import { hexToWorld, HEX_W, HEX_V } from "../hex/hexGrid";
import { useCombatStore } from "../combat/combatStore";
import { usePlayStore } from "./playStore";

/** AABB de mundo (x/z) de uma área de células, amostrando os 4 cantos + padding
 * meio-hex (cobre o offset da grade pointy-top). */
function areaAABB(a: { col: number; row: number; w: number; h: number }) {
  const c1 = a.col, r1 = a.row, c2 = a.col + a.w - 1, r2 = a.row + a.h - 1;
  const pts = [hexToWorld(c1, r1), hexToWorld(c2, r1), hexToWorld(c1, r2), hexToWorld(c2, r2)];
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  return {
    minX: Math.min(...xs) - HEX_W() / 2, maxX: Math.max(...xs) + HEX_W() / 2,
    minZ: Math.min(...zs) - HEX_V() / 2, maxZ: Math.max(...zs) + HEX_V() / 2,
  };
}

const TICK_MS = 1000; // dano/cura por segundo enquanto dentro da área

/**
 * Runtime dos gatilhos de área (autorados no editor): a cada frame testa a
 * posição do player contra cada trigger e dispara o evento por `kind`:
 *  - warp: teleporta (mesmo mapa) ou navega pra outro mapa (?map=)
 *  - damage/heal: aplica valor por tick (1s) enquanto dentro
 *  - save: grava ponto de respawn ao entrar
 *  - script: (placeholder) — futura ligação com sistema de eventos/NPC
 * Sem setState por frame: só dispara em transições/ticks.
 */
export function TriggerRuntime({ map, playerPos }: { map: GameMap; playerPos: React.MutableRefObject<THREE.Vector3> }) {
  const boxes = useMemo(
    () => (map.triggers ?? []).map((t) => ({ t, box: areaAABB(t.area) })),
    [map],
  );
  const inside = useRef<Set<string>>(new Set()); // ids em que o player está agora
  const tickAcc = useRef<Record<string, number>>({}); // acumulador de tempo por id

  useFrame((_, dtRaw) => {
    if (boxes.length === 0) return;
    const dt = Math.min(dtRaw, 0.1) * 1000;
    const p = playerPos.current;
    const combat = useCombatStore.getState();
    if (!combat.player.alive) return;
    const play = usePlayStore.getState();

    for (const { t, box } of boxes) {
      const within = p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
      const was = inside.current.has(t.id);
      if (within && !was) onEnter(t, p, combat, play);
      if (within) {
        inside.current.add(t.id);
        if (t.kind === "damage" || t.kind === "heal") {
          const acc = (tickAcc.current[t.id] ?? 0) + dt;
          if (acc >= TICK_MS) {
            tickAcc.current[t.id] = acc - TICK_MS;
            const v = t.value ?? 0;
            if (t.kind === "damage") combat.hitPlayer(v, p);
            else combat.healPlayer(v);
          } else {
            tickAcc.current[t.id] = acc;
          }
        }
      } else if (was) {
        inside.current.delete(t.id);
        tickAcc.current[t.id] = 0;
      }
    }
  });

  return null;
}

function onEnter(
  t: MapTrigger,
  p: THREE.Vector3,
  _combat: ReturnType<typeof useCombatStore.getState>,
  play: ReturnType<typeof usePlayStore.getState>,
) {
  if (t.kind === "warp" && t.target) {
    const curMap = new URLSearchParams(window.location.search).get("map") ?? "hexdemo";
    if (t.target.mapId && t.target.mapId !== curMap) {
      // outro mapa: recarrega o mundo com o novo id
      const url = new URL(window.location.href);
      url.searchParams.set("map", t.target.mapId);
      window.location.href = url.toString();
      return;
    }
    // mesmo mapa: teleporta pro alvo
    const w = hexToWorld(t.target.col, t.target.row);
    play.requestWarp(w.x, w.z);
  } else if (t.kind === "save") {
    play.setSavePoint({ x: p.x, z: p.z });
  }
  // script: reservado (eventos/NPC) — ainda não conectado
}
