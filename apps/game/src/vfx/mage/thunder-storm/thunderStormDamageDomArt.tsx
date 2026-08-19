import { registerMultiHitDamageArt } from "../../core/multiHitDamageDomArt";

/**
 * Só os NÚMEROS de Thunder Storm (`ts-dmgnum`/`ts-total`, CSS já existente
 * em `legacyVfxArt.ts` desde a migração original — nada novo a portar) —
 * o raio/aro/faíscas em si (`ts-bolt*`/`ts-ground*`/`ts-shock*`) viraram
 * GPU (`thunderStormVfxDefGpu.tsx`). Componente/update genéricos vivem em
 * `core/multiHitDamageDomArt.tsx` (auditoria multi-hit 2026-08-17) — este
 * arquivo só configura a paleta.
 *
 * `impactAtMs: 0` porque cada pulso NÃO tem fase de "queda" (descarga já
 * em pé, impacta assim que nasce) — e `jitterFn` porque Thunder Storm
 * NUNCA usou `createSeededRng` pro `--dmgx` (usava `((i*37)%64)-32`,
 * puramente determinístico por índice), preservado pixel-a-pixel em vez
 * de forçado pro padrão seeded-RNG das outras 4.
 *
 * `staggerMs: 170` (2026-08-19-u, "velocidade do thunder igual ao
 * eletrocutar") — ERA 260, drift nunca corrigido aqui quando o pedido
 * "sincronizar velocidade da animação/áudio" (2026-08-19) trocou
 * `multiHitShared.ts: THUNDER_PULSE_STAGGER_MS` pra 170 e avisou "manter
 * os DOIS lados em sync" (esta paleta é o outro lado). Também alinha com
 * `spawnLightBoltHits` — o driver do raio de Thunder Storm (chamado sem
 * `staggerMs` explícito em `useWorldEvents.ts`, herda o default
 * `LIGHT_BOLT_STAGGER_MS=170`) já caía rápido; só a cascata de NÚMEROS
 * (e o áudio de impacto, disparado por ela — `aoImpactoMultiHit` mora
 * dentro do `update` genérico em `core/multiHitDamageDomArt.tsx`) estava
 * lenta, dessincronizada do raio.
 */
registerMultiHitDamageArt({
  artKey: "thunder_storm_dmgnum",
  // teto REAL do skill_db (Lv10→10), não mais um chute de 5 (auditoria
  // "count real" 2026-08-19).
  maxHits: 10,
  staggerMs: 170,
  impactAtMs: 0,
  damageNumberMs: 1000,
  totalVisibleMs: 1500,
  headY: 1.8,
  dmgClass: "ts-dmgnum",
  totalClass: "ts-total",
  // 0..-63 — sempre à esquerda do alvo (mesmo pedido aplicado às outras 4
  // skills multi-hit, `multiHitDamageDomArt.tsx: jitterFor`); só o formato
  // determinístico (não seeded-RNG) de Thunder Storm continua diferente.
  jitterFn: (i) => -((i * 37) % 64),
});
