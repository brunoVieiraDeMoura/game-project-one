/**
 * Rampa: encosta LISA entre dois níveis, do jeito que se desenha com um gesto.
 *
 * O pincel `smooth` que já existia tira a média com os vizinhos: ele arredonda um
 * degrau, mas por construção não sabe subir do chão até o topo — a média sempre
 * puxa para o meio, e depois de umas passadas o relevo achata em vez de virar
 * ladeira. A rampa faz o contrário: recebe as DUAS PONTAS (a célula onde o
 * traçado começou e a onde está agora) e interpola a altura ao longo do caminho.
 *
 * Trabalha em coordenadas de CÉLULA, sem tocar em three nem no store, para poder
 * ser conferida em teste com números.
 */

export interface RampCell {
  col: number;
  row: number;
  /**
   * Altura interpolada, FRACIONÁRIA — como o resto do heightmap.
   *
   * Chegou a ser arredondada para nível inteiro aqui, e era o único pincel de
   * relevo que fazia isso: todos os outros (Subir/Descer/Suavizar/Nivelar/
   * Ruído/Puxar/Inflar/Raspar) preservam fração, porque é isso que
   * `grid/heightField` (média nos cantos) precisa para desenhar encosta
   * contínua em vez de degrau. Arredondar aqui produzia patamares — o oposto
   * do que a Rampa promete ("encosta LISA").
   */
  level: number;
  /** 0 na ponta de baixo, 1 na de cima — útil para depurar o traçado */
  t: number;
}

/**
 * Células que a rampa cobre, com a altura de cada uma.
 *
 * O corpo é a faixa de largura `2·raio + 1` ao longo do segmento A→B: para cada
 * célula, projeta-se o vetor A→P sobre A→B (isso dá o `t`), e a altura sai de
 * `h0 + (h1 − h0)·t`. Fora da faixa, nada é tocado.
 *
 * A projeção é feita no segmento e não na reta infinita (`t` é preso em 0..1),
 * senão as pontas continuariam subindo além do que foi arrastado.
 */
export function rampCells(
  a: { col: number; row: number },
  b: { col: number; row: number },
  h0: number,
  h1: number,
  raio: number,
  limites: { width: number; height: number },
): RampCell[] {
  const dx = b.col - a.col;
  const dy = b.row - a.row;
  const len2 = dx * dx + dy * dy;
  const r = Math.max(0, raio);

  // caixa que engloba o segmento inflado pelo raio
  const c0 = Math.max(0, Math.min(a.col, b.col) - r);
  const c1 = Math.min(limites.width - 1, Math.max(a.col, b.col) + r);
  const r0 = Math.max(0, Math.min(a.row, b.row) - r);
  const r1 = Math.min(limites.height - 1, Math.max(a.row, b.row) + r);

  const out: RampCell[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const px = col - a.col;
      const py = row - a.row;
      // sem comprimento (clique parado): a rampa é só o disco na altura de A
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      // distância de P ao ponto correspondente no segmento
      const qx = a.col + dx * t;
      const qy = a.row + dy * t;
      const dist = Math.hypot(col - qx, row - qy);
      if (dist > r + 0.5) continue;
      out.push({ col, row, level: h0 + (h1 - h0) * t, t });
    }
  }
  return out;
}
