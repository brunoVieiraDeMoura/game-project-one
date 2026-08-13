import { z } from "zod";

/**
 * Canonical map schema. Source of truth: .claude/skills/skill-map-format/SKILL.md —
 * update the skill first when changing this schema, and bump metadata.version.
 */

export const CollisionTypeSchema = z.enum(["walkable", "wall", "water", "cliff"]);
export type CollisionType = z.infer<typeof CollisionTypeSchema>;

/** Superfície visual por célula (só usada em mapas terrainMode="blocks"). */
/** "water" = massa parada (lago/mar → tile de água + costa nas margens);
 *  "river" = canal corrente (→ tiles de rio orientados, já com margem própria). */
export const SurfaceTypeSchema = z.enum(["grass", "dirt", "stone", "sand", "snow", "water", "river"]);
export type SurfaceType = z.infer<typeof SurfaceTypeSchema>;

/** altura de 1 degrau de bloco (unidades de mundo) — subir/descer no editor */
export const BLOCK_STEP = 2;

/**
 * Como cada superfície é DESENHADA neste mapa.
 *
 * Só aparência: nada aqui muda colisão, altura ou passagem. Existe porque a
 * mesma superfície quer texturas diferentes de mapa para mapa — a grama de um
 * campo aberto não é a de um pântano — e porque a escala certa depende do
 * tamanho do mapa e do enquadramento da câmera.
 *
 * Ausente = o padrão que o cliente já traz. Um mapa antigo, sem o campo,
 * desenha exatamente como antes.
 */
export const TerrainStyleSchema = z.object({
  /**
   * Variante da textura: o `id` de uma entrada do
   * `public/assets/terrain/manifest.json`. Nome desconhecido cai no padrão em
   * vez de deixar o chão sem textura.
   */
  texture: z.string().optional(),
  /**
   * Unidades de MUNDO por repetição da textura (a célula do rAthena mede 2).
   * Valor alto = padrão maior e mais legível; baixo demais e a textura vira
   * granulado que, de longe, lê como cor sólida.
   */
  scale: z.number().positive().optional(),
});
export type TerrainStyle = z.infer<typeof TerrainStyleSchema>;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const MapPropSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  position: vec3,
  rotation: vec3,
  scale: vec3,
  colliderType: z.enum(["none", "box", "trimesh", "hull"]).optional(),
  tags: z.array(z.string()).optional(),
});
export type MapProp = z.infer<typeof MapPropSchema>;

export const MapSpawnSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["mob", "npc", "player_start", "warp", "road_node", "river_node"]),
    refId: z.string().optional(),
    position: vec3,
    count: z.number().int().positive().optional(),
    respawnTimeMs: z.number().int().nonnegative().optional(),
    radius: z.number().nonnegative().optional(),
    direction: z.number().optional(),
    target: z.object({ mapId: z.string(), position: vec3 }).optional(),
    /** rota de patrulha (NPC): waypoints em mundo + modo de percurso. Autorada no
     * editor com a ferramenta Path; o runtime move o NPC pelos pontos. */
    path: z
      .object({
        points: z.array(vec3),
        mode: z.enum(["loop", "pingpong", "once"]).default("loop"),
        speed: z.number().positive().default(3), // unidades/segundo
      })
      .optional(),
  })
  .refine((s) => (s.kind === "mob" || s.kind === "npc" ? s.refId !== undefined : true), {
    message: "refId is required for mob/npc spawns",
  })
  .refine((s) => (s.kind === "warp" ? s.target !== undefined : true), {
    message: "target is required for warp spawns",
  });
export type MapSpawn = z.infer<typeof MapSpawnSchema>;

/**
 * Gatilho de área: retângulo na grade de células (col/row + largura/altura em
 * células) que dispara um evento tipado quando o jogador entra. Autorado no
 * editor; o runtime (PlayView) consome por `kind`. Eventos ficam TIPADOS (enum),
 * nunca string livre — igual à convenção de efeitos do projeto.
 */
export const TriggerKindSchema = z.enum([
  "warp", // teleporta pro target (mapId + célula)
  "script", // ponto de evento nomeado (OnTouch) — `event` é o rótulo
  "damage", // dano por tick (armadilha/lava) — `value` = dano
  "heal", // cura por tick (área segura) — `value` = cura
  "save", // ponto de save/respawn
]);
export type TriggerKind = z.infer<typeof TriggerKindSchema>;

export const MapTriggerSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    kind: TriggerKindSchema,
    /** área retângular em células: canto (col,row) + tamanho (w,h) em células */
    area: z.object({
      col: z.number().int().nonnegative(),
      row: z.number().int().nonnegative(),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
    /** destino do warp (mapId + célula alvo) */
    target: z.object({ mapId: z.string(), col: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).optional(),
    /** rótulo do evento (kind=script) */
    event: z.string().optional(),
    /** valor de dano/cura por tick (kind=damage|heal) */
    value: z.number().optional(),
  })
  .refine((t) => (t.kind === "warp" ? t.target !== undefined : true), {
    message: "target is required for warp triggers",
  });
export type MapTrigger = z.infer<typeof MapTriggerSchema>;

/** sol + ambiente do editor (painel "Camadas & Luz") — salvo no mapa pro /play
 * bater com o que foi ajustado no editor (antes o play usava sol fixo). */
export const LightingSchema = z.object({
  sunAzimuth: z.number(), // graus (direção do sol no plano)
  sunElevation: z.number(), // graus (altura do sol)
  sunIntensity: z.number(),
  ambient: z.number(),
});
export type Lighting = z.infer<typeof LightingSchema>;
export const DEFAULT_LIGHTING: Lighting = { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 };

/**
 * Céu do mapa (painel "Camadas & Luz" do editor, junto de `lighting`).
 *
 * `skyId` é uma CHAVE, não um caminho de arquivo — quem resolve `skyId` →
 * `/assets/sky/*.png` é `apps/game/src/scene/skyCatalog.ts` (a lista real de
 * arquivos, derivada de `assets-new/sky`, vive só lá; este pacote não sabe
 * nada de asset, só guarda a escolha). Chave desconhecida = cliente cai no
 * default dele, não é erro de schema.
 */
export const SkySchema = z.object({ skyId: z.string() });
export type SkyConfig = z.infer<typeof SkySchema>;
export const DEFAULT_SKY: SkyConfig = { skyId: "day" };

/**
 * UMA entrada de partícula ambiental do mapa (painel "Camadas & Luz").
 *
 * `particleId` também é chave, não asset — o catálogo real (textura, cor,
 * blending por tipo) mora em `apps/game/src/vfx/AmbientParticles.tsx`, pro
 * mesmo motivo do céu: este pacote não referencia arquivo nenhum.
 */
export const AmbientParticleConfigSchema = z.object({
  particleId: z.string(),
  enabled: z.boolean().default(true),
  /** 0..1 — controla QUANTIDADE (não é opacidade); ver AmbientParticles */
  intensity: z.number().min(0).max(1).default(0.5),
  scale: z.number().positive().default(1),
  speed: z.number().positive().default(1),
});
export type AmbientParticleConfig = z.infer<typeof AmbientParticleConfigSchema>;

export const GameMapSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    size: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    // Assumption from skill-map-format: 5 world units per cell (RO convention),
    // not yet verified against source — confirm before relying on it for physics scale.
    cellSize: z.number().positive(),
    /**
     * Que grade este mapa usa:
     *  • "square" — grade QUADRADA, uma célula = uma célula do rAthena. É o modo
     *    do jogo: o mapa do servidor desenhado no tamanho real (`prt_fild08` =
     *    400×400), com a colisão que veio do `map_cache.dat`.
     *  • "blocks" — hexágonos KayKit com altura, dos mapas autorados no editor.
     *  • "smooth" — plano legado achatado (mapas migrados antes do "square");
     *    mantido só por compatibilidade, não recebe conteúdo novo.
     *
     * Default "smooth" porque é o que os mapas gravados antes deste campo eram.
     */
    terrainMode: z.enum(["smooth", "blocks", "square"]).default("smooth"),
    heightmap: z.array(z.number()),
    collision: z.array(CollisionTypeSchema),
    /** superfície visual por célula (blocos). Vazio = deriva da colisão. */
    surface: z.array(SurfaceTypeSchema).default([]),
    /** textura e escala de cada superfície NESTE mapa. Vazio = padrão do cliente. */
    terrainStyle: z.record(SurfaceTypeSchema, TerrainStyleSchema).default({}),
    waterLevel: z.number().nullable(),
    props: z.array(MapPropSchema),
    spawns: z.array(MapSpawnSchema),
    /** gatilhos de área (warp/script/dano/cura/save). Opcional p/ back-compat. */
    triggers: z.array(MapTriggerSchema).default([]),
    /** rampas (subidas de 1 nível) achatadas em pares [índiceDaCélula, bordaDeDescida].
     * Esparso: só as células que são rampa entram. A borda (0-5, k×60°) aponta pro
     * lado BAIXO; o lado oposto encosta no nível de cima. Ver skill-map-format. */
    ramps: z.array(z.number().int()).default([]),
    /** sol/ambiente do editor. Opcional p/ back-compat (mapas antigos usam DEFAULT_LIGHTING). */
    lighting: LightingSchema.default(DEFAULT_LIGHTING),
    /** céu do mapa. Opcional p/ back-compat (mapas antigos usam DEFAULT_SKY). */
    sky: SkySchema.default(DEFAULT_SKY),
    /** partículas ambientais do mapa. Vazio = nenhuma (comportamento de antes). */
    ambientParticles: z.array(AmbientParticleConfigSchema).default([]),
    /**
     * Tamanho de bloco (ServerConfig.gameplay.hexScale) em que as POSIÇÕES de
     * props/spawns/rotas deste mapa foram autoradas.
     *
     * `position` é coordenada de MUNDO, e o hexScale multiplica o mundo inteiro
     * — então um mapa desenhado com hexScale 1 e aberto com 10 tem o terreno
     * 10× maior e todo o resto parado na origem: o player nasce na quina,
     * olhando pra fora do mapa, em cima dos monstros. Guardando a escala de
     * origem dá pra reescalar na carga (ver hex/mapScale.ts). Mapas antigos sem
     * o campo são tratados como 1, que é como o editor rodava.
     */
    authoredHexScale: z.number().positive().default(1),
    /**
     * Amarração com o mapa do rAthena que este mapa 3D representa.
     *
     * O servidor é a autoridade e fala em célula do mapa legado
     * (`prt_fild08`, 400×400); o mapa 3D é uma JANELA dessa grade, não o mapa
     * inteiro. `origin` é a célula do canto (x mínimo, y mínimo) que
     * corresponde à célula 0,0 daqui, então:
     *   célula 3D = célula do servidor − origin
     * Sem isso o personagem nasceria fora do pedaço desenhado.
     *
     * Ausente = mapa puramente local (demo, editor) — nada de servidor.
     */
    legacy: z
      .object({
        /** nome no rAthena, sem .gat (ex.: "prt_fild08") */
        mapName: z.string().min(1),
        originX: z.number().int().nonnegative(),
        originY: z.number().int().nonnegative(),
      })
      .optional(),
    metadata: z.object({
      sourceLegacyMap: z.string().optional(),
      version: z.number().int(),
      generatedAt: z.string(),
    }),
  })
  .refine((m) => m.heightmap.length === m.size.width * m.size.height, {
    message: "heightmap length must equal width*height",
  })
  .refine((m) => m.collision.length === m.size.width * m.size.height, {
    message: "collision length must equal width*height",
  })
  .refine((m) => m.surface.length === 0 || m.surface.length === m.size.width * m.size.height, {
    message: "surface length must equal width*height (or be empty)",
  })
  .refine((m) => m.ramps.length % 2 === 0, { message: "ramps must be flat [cell, edge] pairs" });
export type GameMap = z.infer<typeof GameMapSchema>;

/**
 * Lado de UMA célula, em unidades de mundo — cópia de `SQUARE_SIZE`
 * (`apps/game/src/grid/squareGrid.ts`), não import: `map-format` é o pacote
 * de BAIXO (o jogo depende dele, não o contrário), então não há como puxar a
 * constante de lá sem inverter a dependência. É a MESMA regra de "número
 * copiado" que já vale para `net/pathfind.ts: MAX_WALK_PATH_DEFAULT`
 * (espelha `battle_config.max_walk_path` do servidor) — ver CLAUDE.md: mudar
 * um lado sem o outro é falha muda. Se `SQUARE_SIZE` mudar, este número tem
 * que acompanhar.
 */
const SQUARE_SIZE_COPIADO = 2;

/**
 * Largura do cinturão de borda que todo mapa novo ganha automaticamente ao
 * redor do miolo andável — em UNIDADES DE MUNDO, a única escala física FIXA
 * deste projeto, não em pixel.
 *
 * Por que não pixel: a referência visual (`Desktop/ref/EDITOR DE MAPA +
 * FOG.jpg`) rotula a borda como "50px", mas não existe — em lugar NENHUM do
 * projeto — uma razão fixa pixel↔unidade-de-mundo para mapa (conferido: a
 * coluna "Dimensões" do admin, o schema, `createBlankMap` já recebido, tudo
 * trabalha em CÉLULA crua; e numa câmera 3D em perspectiva essa razão não
 * PODE ser fixa por construção — o mesmo metro de chão ocupa mais ou menos
 * pixel de tela conforme a distância/zoom da câmera muda quadro a quadro).
 * "50px" na imagem é unidade de DESENHO do diagrama (uma ferramenta de
 * mockup 2D), não uma medida do motor do jogo — inventar um fator de
 * conversão só para ter um número "derivado de 50px" seria a mesma proporção
 * arbitrária que se pediu para não inventar. O que a imagem passa de
 * verdade, e que ESTE número preserva, é a ESTRUTURA: largura FIXA (não
 * proporcional ao mapa — ver `createBlankMap`), a mesma em todo lado, medida
 * PARA DENTRO do limite físico.
 *
 * 6 unidades de mundo = 3 células (`DEFAULT_BORDER_WIDTH`) na escala real do
 * jogo (`SQUARE_SIZE_COPIADO = 2`) — larga o bastante para plantar árvore ou
 * pedra sem ficar uma linha de 1 célula, estreita o bastante para não comer
 * mapa pequeno de propósito (ver clamp em `createBlankMap`).
 *
 * A borda é `collision: "wall"` — não andável — mas continua célula comum
 * para todo o resto: `editor/editScope.ts` já classifica bloqueio ligado à
 * moldura como escopo "border" por flood fill, o MESMO mecanismo que já vale
 * para o cinturão de mata dos mapas importados do rAthena (`prt_fild08`
 * etc) — não é um sistema novo, é o mapa em branco passando a alimentar um
 * que já existia e ficava vazio (`scopeCounts` sempre dava border=0 num mapa
 * novo). Como `surface` continua "grass" ali (só a colisão muda),
 * `squareChunks.cellLayer` desenha grama normal e `visualLevel` sobe 1 nível
 * por TIPO — a borda lê como uma faixa gramada ligeiramente elevada, pronta
 * pra receber árvore/pedra/decoração no editor (escopo "border"/"all"), não
 * como parede de pedra.
 */
export const DEFAULT_BORDER_WIDTH_WORLD_UNITS = 6;

/** `DEFAULT_BORDER_WIDTH_WORLD_UNITS` convertido para célula (arredondado —
 * célula é a unidade que `collision`/`heightmap`/`surface` realmente usam). */
export const DEFAULT_BORDER_WIDTH = Math.round(DEFAULT_BORDER_WIDTH_WORLD_UNITS / SQUARE_SIZE_COPIADO);

/**
 * Cria um mapa novo em branco, terreno square (chão de grama plano) — o
 * mesmo `terrainMode` dos mapas importados do rAthena (`prt_fild08` etc).
 *
 * Era `"blocks"` (hexagonal): todo mapa autorado do zero nascia hex, mesmo
 * o projeto não usando mais hexágono nenhum — só o padrão real do rAthena.
 * `cellSize` fica só por compatibilidade do schema; o modo square usa o
 * tamanho fixo de `grid/squareGrid.ts`, não este campo.
 *
 * `borderWidth` grava o cinturão não-andável (ver `DEFAULT_BORDER_WIDTH`).
 * Clampado para nunca comer o mapa inteiro: mesmo no menor mapa que o editor
 * aceita (4×4), sobra pelo menos 1 célula andável de cada lado — sem isso um
 * mapa minúsculo com borda larga nasceria sem miolo nenhum para jogar.
 */
export function createBlankMap(
  id: string,
  name: string,
  width = 32,
  height = 32,
  cellSize = 5,
  borderWidth = DEFAULT_BORDER_WIDTH,
): GameMap {
  const n = width * height;
  const collision = new Array<CollisionType>(n).fill("walkable");
  const bw = Math.max(0, Math.min(borderWidth, Math.floor((Math.min(width, height) - 1) / 2)));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (col < bw || row < bw || col >= width - bw || row >= height - bw) {
        collision[row * width + col] = "wall";
      }
    }
  }
  return {
    id,
    name,
    size: { width, height },
    cellSize,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision,
    surface: new Array(n).fill("grass"),
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
    // mapa novo nasce em unidades nativas; o editor grava a escala real no save
    authoredHexScale: 1,
    lighting: { ...DEFAULT_LIGHTING },
    sky: { ...DEFAULT_SKY },
    ambientParticles: [],
    metadata: { version: MAP_SCHEMA_VERSION, generatedAt: new Date().toISOString() },
  };
}

/** Row-major cell index (index = y * width + x). */
export function cellIndex(map: Pick<GameMap, "size">, x: number, y: number): number {
  return y * map.size.width + x;
}

export const MAP_SCHEMA_VERSION = 6; // v6: terrainStyle (textura+escala por superfície)

export { resizeGameMap, objetosForaDosLimites, type ResizeMapResult } from "./resize";
