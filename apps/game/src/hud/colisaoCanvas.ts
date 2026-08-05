import type { GameMap } from "@ragnarok/map-format";
import { MM_COLORS } from "../ui/minimap";

/**
 * A colisão do mapa pré-desenhada num canvas do TAMANHO DO MAPA, uma vez só.
 *
 * Quem quiser mostrar o mapa (minimapa, janela do Alt+M) recorta um pedaço
 * deste com `drawImage` — redesenhar as 160.000 células de um `prt_fild08` por
 * quadro, para seguir o personagem, seria impagável.
 *
 * O cache é um `WeakMap` chaveado pelo próprio `GameMap`, a mesma dependência
 * que o `useMemo` do minimapa já usava. A diferença é que agora minimapa e
 * janela COMPARTILHAM o canvas em vez de cada um manter o seu: um 400×400 são
 * 640 KB de bitmap, e a janela do mapa é aberta e fechada o tempo todo.
 *
 * O y é INVERTIDO aqui (norte em cima). O espelho em X, não: ele é do
 * container de quem desenha (o minimapa nasceu assim, e é o que faz a
 * orientação bater com a da câmera — no mundo 3D o +x cai à ESQUERDA da tela).
 * Baked aqui, ele quebraria as duas contas de posição já provadas.
 */
const cache = new WeakMap<GameMap, HTMLCanvasElement>();

export function canvasDeColisao(map: GameMap): HTMLCanvasElement {
  const pronto = cache.get(map);
  if (pronto) return pronto;

  const { width, height } = map.size;
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  cache.set(map, off);

  const ctx = off.getContext("2d");
  if (!ctx) return off;

  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = map.collision[y * width + x];
      // norte em cima: inverte y
      const di = ((height - 1 - y) * width + x) * 4;
      const c =
        t === "wall"
          ? MM_COLORS.wall
          : t === "water"
            ? MM_COLORS.water
            : t === "cliff"
              ? MM_COLORS.cliff
              : MM_COLORS.walkable;
      img.data[di] = c[0];
      img.data[di + 1] = c[1];
      img.data[di + 2] = c[2];
      img.data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return off;
}
