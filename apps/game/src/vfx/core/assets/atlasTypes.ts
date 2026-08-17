/**
 * Contrato do metadata de atlas — o formato que QUALQUER atlas definitivo
 * (item 6 do pedido) precisa cumprir para o `SpriteRenderer`/`ParticleRenderer`
 * conseguirem ler UV por frame. Nenhum arquivo real existe ainda (invariante
 * leia1.txt) — este módulo só declara a FORMA, validada em runtime por
 * `validateAtlasMetadata()` quando um atlas de verdade for registrado em
 * `manifest.ts`.
 */

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasAnimationEntry {
  frames: string[];
  fps: number;
}

export interface AtlasMetadata {
  /** nome do frame → retângulo em PIXELS dentro da imagem do atlas */
  frames: Record<string, AtlasFrame>;
  /** animações nomeadas pré-definidas no atlas — opcional; uma
   * `VfxDefinition.animation` pode listar os frames diretamente em vez de
   * referenciar uma animação nomeada daqui. */
  animations?: Record<string, AtlasAnimationEntry>;
  /** dimensões da imagem — necessário pra normalizar px → UV (0..1) */
  image: { width: number; height: number };
}

export class AtlasMetadataError extends Error {}

/** validação estrutural mínima — sem depender de zod (não é dependência
 * direta de `apps/game` hoje; adicionar uma lib só pra isto seria fora do
 * escopo pedido). Lança `AtlasMetadataError` com o campo que falhou. */
export function validateAtlasMetadata(raw: unknown): AtlasMetadata {
  if (typeof raw !== "object" || raw === null) throw new AtlasMetadataError("metadata não é um objeto");
  const obj = raw as Record<string, unknown>;

  const image = obj.image as Record<string, unknown> | undefined;
  if (!image || typeof image.width !== "number" || typeof image.height !== "number") {
    throw new AtlasMetadataError("metadata.image.{width,height} ausente ou inválido");
  }

  const framesRaw = obj.frames;
  if (typeof framesRaw !== "object" || framesRaw === null) {
    throw new AtlasMetadataError("metadata.frames ausente ou inválido");
  }
  const frames: Record<string, AtlasFrame> = {};
  for (const [name, value] of Object.entries(framesRaw as Record<string, unknown>)) {
    const f = value as Record<string, unknown>;
    if (
      typeof f?.x !== "number" ||
      typeof f?.y !== "number" ||
      typeof f?.w !== "number" ||
      typeof f?.h !== "number"
    ) {
      throw new AtlasMetadataError(`metadata.frames["${name}"] inválido — precisa de {x,y,w,h} numéricos`);
    }
    frames[name] = { x: f.x, y: f.y, w: f.w, h: f.h };
  }

  let animations: Record<string, AtlasAnimationEntry> | undefined;
  if (obj.animations !== undefined) {
    if (typeof obj.animations !== "object" || obj.animations === null) {
      throw new AtlasMetadataError("metadata.animations inválido");
    }
    animations = {};
    for (const [name, value] of Object.entries(obj.animations as Record<string, unknown>)) {
      const a = value as Record<string, unknown>;
      if (!Array.isArray(a?.frames) || typeof a?.fps !== "number") {
        throw new AtlasMetadataError(`metadata.animations["${name}"] inválido — precisa de {frames[],fps}`);
      }
      animations[name] = { frames: a.frames as string[], fps: a.fps };
    }
  }

  return { frames, animations, image: { width: image.width, height: image.height } };
}

/** retângulo do frame convertido pra UV (0..1, origem no canto inferior
 * esquerdo — convenção do three.js) — usado pelo `SpriteRenderer` pra
 * escrever o atributo de UV por instância. */
export function frameToUv(frame: AtlasFrame, image: { width: number; height: number }): { u0: number; v0: number; u1: number; v1: number } {
  const u0 = frame.x / image.width;
  const u1 = (frame.x + frame.w) / image.width;
  // Y da imagem cresce pra baixo, V do three.js cresce pra cima — inverte.
  const v1 = 1 - frame.y / image.height;
  const v0 = 1 - (frame.y + frame.h) / image.height;
  return { u0, v0, u1, v1 };
}
