/**
 * Lógica de jogo que roda no cliente.
 *
 * As FÓRMULAS (dano, sub-stats, taxas) saíram daqui: quem calcula isso é o
 * rAthena, e manter uma segunda implementação em TypeScript só criava dois
 * números diferentes para a mesma coisa. O que sobrou é o que continua sendo
 * do cliente: movimento (interpolação e clique-tile) e consulta de terreno.
 */
export * from "./movement";
export * from "./map-terrain";
