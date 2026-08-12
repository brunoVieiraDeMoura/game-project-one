/**
 * Reta de células (Bresenham) entre duas posições da grade — pra pincel de
 * relevo não pular célula durante um arrasto rápido (ver uso em
 * `EditorScene.tsx: onMove`, seção "traço contínuo").
 *
 * Inclui as DUAS pontas. Chamar com `(x,y,x,y)` (sem movimento) devolve só
 * `[[x,y]]`, uma célula — é o caso comum (mouse parado, pintando no lugar).
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}
