import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { GameplayConfig } from "@ragnarok/game-data";
import { GROUND_NOISE_GLSL } from "../scene/groundNoise.glsl";
import {
  buildChunkGeometry,
  buildWaterGeometry,
  chunkCenter,
  chunkCounts,
  chunksSujos,
  CHUNK_CELLS,
  type ChunkSource,
} from "./squareChunks";
import { SQUARE_SIZE } from "./squareGrid";

/**
 * O chão dos mapas do rAthena.
 *
 * Desenha só os CHUNKS dentro do raio de visão — o mapa inteiro tem 400×400
 * células e nunca cabe num frame. O recorte segue o mesmo padrão do
 * `HexTerrain` (janela de chunks ao redor do centro + teste de distância), e o
 * centro vem do `useViewCenter`, que só muda a cada tantas unidades andadas:
 * a geometria de um chunk é construída uma vez e fica em cache.
 *
 * Sem colisor de física: quem decide onde se pode pisar é o `TerrainQuery`
 * (grid/squareTerrainQuery) — no online, o servidor. Um trimesh de 169 pedaços
 * seria custo puro.
 */
export function SquareTerrain({
  map,
  center,
  radius,
  ground,
}: {
  map: GameMap;
  center?: { x: number; z: number };
  radius?: number;
  ground?: GameplayConfig;
}) {
  const cache = useRef(new Map<string, THREE.BufferGeometry>());
  const aguaCache = useRef(new Map<string, THREE.BufferGeometry | null>());
  // de quais arrays as geometrias em cache foram construídas
  const fonte = useRef<ChunkSource | null>(null);
  const material = useMemo(
    () => makeSquareGroundMaterial(ground),
    [ground?.groundTextureScale, ground?.groundTextureStrength],
  );
  const materialAgua = useMemo(() => makeWaterMaterial(), []);

  // geometrias vivem fora do React: solta a memória ao sair da cena
  useEffect(() => {
    const chao = cache.current;
    const agua = aguaCache.current;
    return () => {
      for (const geo of chao.values()) geo.dispose();
      for (const geo of agua.values()) geo?.dispose();
      chao.clear();
      agua.clear();
    };
  }, []);

  const visible = useMemo(() => {
    // Invalidar aqui, no RENDER — não num effect.
    //
    // O cache é um `useRef` chaveado só pela posição do chunk, então um mapa
    // editado (pincel, "Remover bloqueios") devolvia a geometria ANTIGA: este
    // useMemo lê o cache durante o render, e o cleanup do effect só rodava
    // depois do commit, sem agendar render novo — a mudança existia no store e
    // não aparecia na tela. Comparar a IDENTIDADE dos arrays resolve os dois
    // casos (edição e troca de mapa) com um caminho só, porque o editorStore é
    // imutável: mexer numa célula recria o array inteiro.
    const atual = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const anterior = fonte.current;
    if (
      anterior &&
      (anterior.collision !== atual.collision ||
        anterior.surface !== atual.surface ||
        anterior.heightmap !== atual.heightmap)
    ) {
      // Só os chunks que mudaram de verdade. Jogar o cache inteiro fora custava
      // 198 ms medidos (169 geometrias) por edição — de pouco em cada pincelada,
      // o editor engasga. Varrer 160.000 posições comparando referência é
      // ~1 ms, e uma pincelada suja um chunk ou dois.
      for (const key of chunksSujos(map, anterior, atual)) {
        cache.current.get(key)?.dispose();
        aguaCache.current.get(key)?.dispose();
        cache.current.delete(key);
        aguaCache.current.delete(key);
      }
    }
    fonte.current = atual;

    const { cols, rows } = chunkCounts(map);
    const out: { key: string; geo: THREE.BufferGeometry; agua: THREE.BufferGeometry | null }[] = [];
    // quanto custou reconstruir nesta passada (o editor paga isso a cada edição)
    let construidos = 0;
    let custoMs = 0;
    const cull = center != null && radius != null;
    // raio em chunks, com folga de um para a diagonal
    const chunkSpan = CHUNK_CELLS * SQUARE_SIZE;
    const rc = cull ? Math.ceil(radius! / chunkSpan) + 1 : Math.max(cols, rows);
    const c0 = cull
      ? { cx: Math.floor(center!.x / chunkSpan), cz: Math.floor(center!.z / chunkSpan) }
      : { cx: 0, cz: 0 };
    const colStart = cull ? Math.max(0, c0.cx - rc) : 0;
    const colEnd = cull ? Math.min(cols, c0.cx + rc + 1) : cols;
    const rowStart = cull ? Math.max(0, c0.cz - rc) : 0;
    const rowEnd = cull ? Math.min(rows, c0.cz + rc + 1) : rows;
    // alcance do teste de distância: raio + meia diagonal do chunk, senão o
    // pedaço em que o jogador está seria descartado quando ele anda para a borda
    const reach = cull ? radius! + chunkSpan * 0.71 : 0;

    for (let cz = rowStart; cz < rowEnd; cz++) {
      for (let cx = colStart; cx < colEnd; cx++) {
        if (cull) {
          const cc = chunkCenter(cx, cz);
          const dx = cc.x - center!.x, dz = cc.z - center!.z;
          if (dx * dx + dz * dz > reach * reach) continue;
        }
        const key = `${cx},${cz}`;
        let geo = cache.current.get(key);
        if (!geo) {
          const t0 = performance.now();
          geo = buildChunkGeometry(map, cx, cz);
          cache.current.set(key, geo);
          construidos++;
          custoMs += performance.now() - t0;
        }
        let agua = aguaCache.current.get(key);
        if (agua === undefined) {
          agua = buildWaterGeometry(map, cx, cz);
          aguaCache.current.set(key, agua);
        }
        out.push({ key, geo, agua });
      }
    }
    if (import.meta.env.DEV) {
      // ACUMULA: um render seguinte (câmera andou) roda este memo com o cache
      // cheio, e um contador de "última passada" voltaria a zero — foi o que quase
      // me fez concluir que a invalidação não funcionava.
      const w = window as unknown as { __terrainBuild?: { chunks: number; ms: number; passadas: number } };
      const acc = w.__terrainBuild ?? { chunks: 0, ms: 0, passadas: 0 };
      w.__terrainBuild = {
        chunks: acc.chunks + construidos,
        ms: Math.round((acc.ms + custoMs) * 10) / 10,
        passadas: acc.passadas + 1,
      };
    }
    return out;
  }, [map, map.collision, map.surface, map.heightmap, center?.x, center?.z, radius]);

  if (import.meta.env.DEV) {
    (window as unknown as { __terrainStats?: unknown }).__terrainStats = {
      chunks: visible.length,
      chunksEmCache: cache.current.size,
      celulasPorChunk: CHUNK_CELLS * CHUNK_CELLS,
      mapa: `${map.size.width}x${map.size.height}`,
    };
  }

  return (
    <group>
      {visible.map(({ key, geo, agua }) => (
        <group key={key}>
          <mesh geometry={geo} material={material} receiveShadow />
          {agua && <mesh geometry={agua} material={materialAgua} />}
        </group>
      ))}
    </group>
  );
}

/**
 * Lâmina d'água: translúcida, quase sem brilho difuso e sem sombra.
 *
 * O leito fica afundado (`visualLevel`), então a transparência deixa o fundo
 * aparecer e a água ganha profundidade sem textura nenhuma — o mesmo truque de
 * paleta chapada que o resto do terreno usa.
 */
function makeWaterMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2f6ea8"),
    transparent: true,
    opacity: 0.78,
    roughness: 0.25,
    metalness: 0.1,
    // sem `depthWrite` a água não apaga o que está atrás dela na mesma célula
    depthWrite: false,
  });
}

/**
 * Material do chão quadrado: cor por vértice + o MESMO ruído do mundo hexagonal.
 *
 * A cor vem do vértice (grama/terra/pedra/água por célula), então não há atlas
 * para recolorir como em `hex/groundMaterial.ts` — só o ruído, que é o que tira
 * o aspecto de plano chapado. Amostrado em coordenada de mundo: o padrão não
 * repete célula a célula e não desenha a grade.
 */
function makeSquareGroundMaterial(ground?: GameplayConfig): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    // Sem `flatShading`: quem manda é o atributo `normal`, que vem do gradiente do
    // campo de altura (grid/heightField). Com ele ligado, cada face acendia com um
    // tom só e a encosta voltava a parecer uma pilha de caixas, por mais suave que
    // fosse a geometria. A cor continua chapada por célula — ela vem do atributo
    // `color`, não da iluminação.
    flatShading: false,
  });
  const freq = 1 / Math.max(0.01, ground?.groundTextureScale ?? 2.5);
  const amount = ground?.groundTextureStrength ?? 0.35;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundFreq = { value: freq };
    shader.uniforms.uGroundNoise = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vGroundWorld;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGroundWorld;
uniform float uGroundFreq;
uniform float uGroundNoise;
${GROUND_NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  if (uGroundNoise > 0.0) {
    vec2 gp = vGroundWorld.xz * uGroundFreq;
    // duas escalas: manchas largas + granulado fino (grama de perto)
    float n = groundFbm(gp) * 0.75 + groundFbm(gp * 5.0) * 0.25;
    diffuseColor.rgb *= 1.0 + (n - 0.5) * uGroundNoise * 1.4;
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => `square-ground:${freq.toFixed(3)}:${amount.toFixed(3)}`;
  return mat;
}
