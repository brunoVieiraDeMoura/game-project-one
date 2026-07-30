import type { EntityKind } from "../protocol.js";

/**
 * objecttype dos pacotes de spawn -> tipo que o cliente 3D entende.
 *
 * Valores conferidos em rathena/src/map/clif.cpp:345 (`clif_bl_type`) — nao
 * chute: 0x5 e MONSTRO e 0x6 e NPC, o inverso do que a ordem sugere.
 */
export function entityKindFromObjectType(objecttype: number | undefined): EntityKind {
	switch (objecttype) {
		case 0x0:
		case 0x1: // PC disfarcado
			return "player";
		case 0x2:
			return "item";
		case 0x3:
			return "skill";
		case 0x5: // NPC_MOB_TYPE
		case 0xd: // ABR
		case 0xe: // BIONIC
			return "mob";
		case 0x6: // NPC_EVT_TYPE
		case 0x7: // pet
		case 0x8: // homunculo
		case 0x9: // mercenario
		case 0xa: // elemental
		case 0xc: // NPC que anda
			return "npc";
		default:
			return "unknown";
	}
}
