import type { ServerConfig } from "@ragnarok/game-data";

/** Config global padrão (taxas 1× = renewal cru). Editável no Gerenciador
 * Global; isto é só o default de carga inicial. */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  expRateBase: 1,
  expRateJob: 1,
  dropRate: 1,
  dropRateOverrides: [],
  expRateOverrides: [],
  defaultMovementMode: "grid",
  allowMovementModeSwitch: true,
  gameplay: {
    moveSpeed: 20,
    jumpHeight: 1.1,
    gravity: 22,
    cameraDistance: 16,
    cameraMaxZoom: 7,
    cameraRotateSpeed: 0.006,
    animationSpeed: 1,
    charScale: 1,
    hexScale: 1,
    retroMode: "off",
    retroPixelSize: 6,
    retroDither: true,
    groundMode: "atlas",
    groundColor: "#bfc537",
    groundTextureScale: 2.5,
    groundTextureStrength: 0.35,
    renderDistance: 140,
    fogNear: 90,
    fogFar: 135,
  },
  version: 1,
  updatedAt: "2026-07-19T00:00:00.000Z",
};
