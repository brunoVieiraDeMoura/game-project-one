/**
 * `opt1` ("estado do corpo") — mesmo enum do rAthena (`status.hpp`), nunca
 * bitmask, sempre posição ÚNICA. Ver `net/gateway.ts: entity:option` e
 * `NetEntity.opt1` (`net/worldStore.ts`) pra origem do dado.
 */
export const OPT1_NONE = 0;
export const OPT1_STONE = 1;
export const OPT1_FREEZE = 2;
export const OPT1_STUN = 3;
export const OPT1_SLEEP = 4;
export const OPT1_STONEWAIT = 6;
export const OPT1_BURNING = 7;
export const OPT1_IMPRISON = 8;

/**
 * `opt2` ("healthState" no `ZC_STATE_CHANGE`/0x229) — BITMASK, diferente de
 * `opt1`: vários bits ativos ao mesmo tempo (`status.hpp:2986-2996`, valores
 * conferidos byte a byte, não estimados). Cada bit corresponde a um
 * `Status:` de `status.yml` com `Opt2:` (não `Opt1:`) — família
 * arquiteturalmente separada de body-state (auditoria "opt2/healthState"
 * 2026-08-14).
 *
 * | bit  | valor  | Status (status.yml) | tratado como pseudo-ícone? |
 * |------|--------|----------------------|------------------------------|
 * | 0    | 0x0001 | Poison               | sim (`HEALTH_STATE_LOCKING_BITS`) |
 * | 1    | 0x0002 | Curse                | sim |
 * | 2    | 0x0004 | Silence              | sim |
 * | 3    | 0x0008 | Confusion            | sim |
 * | 4    | 0x0010 | Blind                | sim |
 * | 5    | 0x0020 | Angelus              | não — é BUFF (Angelus), fora do escopo "debuff em inimigo" |
 * | 6    | 0x0040 | Bleeding             | não — já tem `Icon: EFST_BLOODING` real (0x983/duração), incluir aqui duplicaria |
 * | 7    | 0x0080 | Dpoison              | não pedido nesta rodada — dá pra somar depois, mesmo padrão |
 * | 8    | 0x0100 | (Fear não declara `Opt2:` em status.yml nesta versão — bit reservado, não usado) | não |
 */
export const OPT2_NONE = 0x0;
export const OPT2_POISON = 0x0001;
export const OPT2_CURSE = 0x0002;
export const OPT2_SILENCE = 0x0004;
export const OPT2_CONFUSION = 0x0008;
export const OPT2_BLIND = 0x0010;
export const OPT2_ANGELUS = 0x0020;
export const OPT2_BLEEDING = 0x0040;
export const OPT2_DPOISON = 0x0080;
export const OPT2_FEAR = 0x0100;
