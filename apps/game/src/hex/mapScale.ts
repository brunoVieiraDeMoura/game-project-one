import type { GameMap, MapProp, MapSpawn } from "@ragnarok/map-format";

/**
 * REESCALA as posições de um mapa para o tamanho de bloco em uso.
 *
 * O terreno é desenhado a partir de (col,row) — cresce sozinho com o hexScale.
 * Já props, spawns e rotas de patrulha guardam coordenada de MUNDO, que foi
 * calculada com o hexScale ativo quando o mapa foi salvo (`authoredHexScale`).
 * Abrir um mapa autorado em escala 1 com hexScale 10 deixava o terreno 10×
 * maior e todo o resto amontoado perto da origem: o player nascia na quina do
 * mapa, olhando pra fora (tela só com céu) e dentro do grupo de monstros, que
 * o matavam em segundos.
 *
 * O TAMANHO do prop (`scale`) acompanha junto. A regra "props mantêm a escala
 * autorada" vale pra quem MEXE no hexScale sem converter nada; aqui é conversão
 * de unidade: uma árvore escolhida pra caber num hexágono de 2 unidades vira
 * mato num hexágono de 20 se só a posição escalar. Quem quer mudar o tamanho de
 * um asset continua fazendo em /asset-scaling.
 */
export function scaleMapPositions(map: GameMap, hexScale: number): GameMap {
  const authored = map.authoredHexScale || 1;
  const k = hexScale / authored;
  if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-6) return map;

  const p3 = (v: [number, number, number]): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  const props: MapProp[] = map.props.map((p) => ({ ...p, position: p3(p.position), scale: p3(p.scale) }));
  const spawns: MapSpawn[] = map.spawns.map((s) => ({
    ...s,
    position: p3(s.position),
    // raio do spawn também é distância de mundo
    ...(s.radius != null ? { radius: s.radius * k } : {}),
    ...(s.path ? { path: { ...s.path, points: s.path.points.map(p3), speed: s.path.speed * k } } : {}),
  }));
  return { ...map, props, spawns, authoredHexScale: hexScale };
}
