import { useEffect, useState } from "react";
import { GameplayConfigSchema, type GameplayConfig } from "@ragnarok/game-data";
import { clampHexScale } from "../hex/hexGrid";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** default = todos os campos do schema (fallback se API cair) */
export const DEFAULT_GAMEPLAY: GameplayConfig = GameplayConfigSchema.parse({});

/**
 * Converte os campos de DISTÂNCIA para o tamanho de bloco em uso.
 *
 * Os valores do editor são em "unidades de hexágono nativo" (hexScale = 1).
 * Como o hexScale multiplica o mundo inteiro — inclusive a ALTURA de cada
 * nível — deixá-los absolutos quebra tudo quando o bloco cresce: com
 * hexScale 10, a câmera a 6 unidades fica dentro de um degrau de 10, e a
 * névoa em 60–80 fecha antes do primeiro hexágono. Escalando junto, mudar o
 * tamanho do bloco preserva o enquadramento e o alcance de visão.
 *
 * `charScale` TAMBÉM escala: ele é a proporção do personagem em relação ao
 * hexágono ("~0.34 = 1/4 do hex", como o schema descreve), não um tamanho
 * absoluto. Deixá-lo fixo enquanto terreno e props crescem transformava o
 * personagem numa formiga e as árvores em arranha-céus ao mudar o hexScale.
 *
 * `jumpHeight` e `gravity` escalam JUNTOS de propósito: o tempo de voo é
 * sqrt(2h/g), então o arco continua com a mesma duração — só fica do tamanho
 * do novo mundo.
 */
export function scaleToWorld(cfg: GameplayConfig): GameplayConfig {
  // usa a escala EFETIVA (a mesma que o grid aplica): se a config passar do
  // limite, o terreno seria desenhado num tamanho e as distâncias noutro
  const s = clampHexScale(cfg.hexScale);
  if (s === 1) return { ...cfg, hexScale: s };
  return {
    ...cfg,
    hexScale: s,
    charScale: cfg.charScale * s,
    cameraDistance: cameraDistanceFor(cfg),
    renderDistance: cfg.renderDistance * s,
    fogNear: cfg.fogNear * s,
    fogFar: cfg.fogFar * s,
    moveSpeed: cfg.moveSpeed * s,
    jumpHeight: cfg.jumpHeight * s,
    gravity: cfg.gravity * s,
  };
}

/**
 * charScale de referência: o valor em que `cameraDistance` foi calibrado.
 *
 * Vale o DEFAULT de `charScale` (server-config) — hoje 1, "uma célula = um
 * personagem", como no Ragnarok. Enquanto estava em 0,34 (o default antigo),
 * qualquer mapa com hexScale ≠ 1 empurrava a câmera para quase 3× a distância
 * certa, porque a conta comparava o personagem novo com a calibragem velha.
 */
const CHAR_SCALE_REF = 1;
/** a câmera nunca fica mais perto que isto × a altura de um nível */
const MIN_LEVELS_AWAY = 1.6;

/**
 * A distância da câmera segue o PERSONAGEM (é ele que precisa caber na tela),
 * com um piso ligado ao tamanho do bloco.
 *
 * Só escalar pelo mundo afastaria a câmera 10× num personagem que continua do
 * mesmo tamanho — ele vira um ponto. Só escalar pelo personagem mantém a
 * câmera a 6 unidades num mundo onde cada degrau tem 10 de altura — ela fica
 * DENTRO do terreno (o que acontecia). O piso resolve o segundo caso sem
 * estragar o primeiro: quem sobe charScale junto com hexScale (proporção
 * mantida) cai no ramo do personagem e nada muda pra ele.
 */
export function cameraDistanceFor(cfg: GameplayConfig): number {
  const s = clampHexScale(cfg.hexScale);
  // o personagem já cresce com o mundo, então a câmera segue a proporção dele
  const porPersonagem = cfg.cameraDistance * ((cfg.charScale * s) / CHAR_SCALE_REF);
  return Math.max(porPersonagem, s * MIN_LEVELS_AWAY);
}

/**
 * Busca o bloco `gameplay` do server_config (editado no admin /game-editor) e
 * aplica no cliente 3D. Uma vez, no mount; cai no default se a API falhar.
 */
export function useGameplayConfig(): GameplayConfig {
  const [cfg, setCfg] = useState<GameplayConfig>(DEFAULT_GAMEPLAY);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/server-config`)
      .then((r) => r.json())
      .then((d) => {
        const parsed = GameplayConfigSchema.safeParse(d?.gameplay);
        if (!cancelled && parsed.success) setCfg(parsed.data);
        // aux de dev: conferir no console o que a API mandou (window.__gameplay)
        if (import.meta.env.DEV && typeof window !== "undefined") {
          (window as unknown as { __gameplay?: unknown }).__gameplay = parsed.success ? parsed.data : { error: parsed.error?.issues };
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return cfg;
}
