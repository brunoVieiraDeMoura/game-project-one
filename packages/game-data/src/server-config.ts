import { z } from "zod";
import { ItemTypeSchema } from "./item";

/**
 * Global server manager (soul.txt §5.7): EXP/drop multipliers, global or
 * per-category. Read from DB/cache at runtime by engine-core — hot-reload,
 * no game-server restart.
 */

export const RateOverrideSchema = z.object({
  /** category the override applies to */
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("itemType"), itemType: ItemTypeSchema }),
    z.object({ kind: z.literal("mvpDrops") }),
    z.object({ kind: z.literal("mapId"), mapId: z.string() }),
  ]),
  multiplier: z.number().positive(),
});

/**
 * Ajustes do cliente 3D (editor do game no admin). Todos com default, então
 * linhas de server_config antigas ganham o bloco automaticamente (jsonb, sem
 * migração). O game (apps/game) lê via GET /server-config e aplica.
 */
export const GameplayConfigSchema = z.object({
  /**
   * Velocidade de movimento do personagem, em unidades de mundo/segundo — a
   * MESMA nos dois modos (clique-tile e WASD livre), por decisão de projeto
   * (next-change-game.txt): eram dois dials e o clique andava mais devagar/
   * rápido que o WASD conforme o hexScale. O modo grid converte pra células/seg
   * dividindo pelo tamanho da célula (ver play/Player.tsx). Escala com hexScale.
   */
  moveSpeed: z.number().positive().default(20),
  /** altura do pulo (unidades de mundo) */
  jumpHeight: z.number().positive().default(1.1),
  /** velocidade da física de queda (gravidade); maior = cai mais rápido */
  gravity: z.number().positive().default(22),
  /**
   * Distância base da câmera (raio do follow), em unidades de mundo — que
   * valem 2 por célula nas duas grades (hexágono e quadrado).
   *
   * 16 ≈ oito células de raio, ~16 de largura na tela: o enquadramento do
   * Ragnarok. Com 9 (o valor de quando o mundo era uma janela de 32×32) a
   * câmera ficava colada no personagem, e num mapa de 400×400 isso é olhar o
   * campo por um buraco de fechadura.
   */
  cameraDistance: z.number().positive().default(16),
  /** quanto o scroll pode afastar (multiplicador máx do zoom) */
  cameraMaxZoom: z.number().positive().default(7),
  /** sensibilidade de rotação da câmera (arrasto) */
  cameraRotateSpeed: z.number().positive().default(0.006),
  /** multiplicador global das animações (1 = normal) */
  animationSpeed: z.number().positive().default(1),
  /**
   * Escala do personagem/monstros no mundo hex.
   *
   * No Ragnarok uma CÉLULA tem o tamanho de um personagem — é isso que faz o
   * andar em tile parecer certo. Como aqui a célula do servidor é um hexágono
   * (largura 2 em escala 1) e o modelo KayKit tem ~1,8 de altura, `1` deixa o
   * personagem ocupando praticamente uma célula, como no RO. Valores baixos
   * (0,2–0,34) deixavam o mundo com "quadrados gigantes" e faziam o monstro
   * parecer voar: ele anda 1 célula por passo, e a célula era 5× o boneco.
   */
  charScale: z.number().positive().default(1),
  /** tamanho FÍSICO do bloco hexagonal (multiplica o grid inteiro: posições +
   * tile renderizado + movimento). Independente do charScale — sobe isso pra
   * dar impressão de mapa maior sem re-tunar a proporção do personagem, que já
   * é relativa ao hex (ver charScale). Assets/props mantêm sua própria escala
   * autorada (ver /asset-scaling), não crescem automaticamente. */
  hexScale: z.number().positive().default(1),
  /** distância de renderização (raio, unidades de mundo): props/terreno só
   * renderizam dentro desse raio do player. Deve ser > fogFar pra os itens
   * surgirem já dentro da névoa (sem "pop"). 140 ≈ 70 células de raio — num
   * mapa do rAthena (400×400) é o que dá a sensação de campo aberto. */
  renderDistance: z.number().positive().default(140),
  /**
   * CHÃO do mundo hex. Os tiles KayKit não têm textura de chão: a face de cima
   * amostra UM pixel do atlas (a "grama" é a cor 191,197,55 em x81..90,y590 de
   * hexagons_medieval.png), por isso sai chapada. Estes campos trocam isso em
   * runtime, sem mexer no asset:
   *  • "atlas"   — nada muda, a cor original do KayKit
   *  • "color"   — repinta só o que é grama com `groundColor`
   *  • "texture" — grama com padrão procedural (ruído) por cima da cor
   * O material é o MESMO de estrada/rio/água, então a troca é feita no shader,
   * comparando a cor amostrada com a da grama — assim a faixa de terra da
   * estrada e o leito do rio não são afetados.
   */
  groundMode: z.enum(["atlas", "color", "texture"]).default("atlas"),
  /** cor da grama nos modos "color"/"texture" (hex CSS) */
  groundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#bfc537"),
  /** tamanho do padrão no modo "texture", em unidades de mundo por repetição */
  groundTextureScale: z.number().positive().default(2.5),
  /** intensidade do padrão no modo "texture" (0 = liso, 1 = bem marcado) */
  groundTextureStrength: z.number().min(0).max(1).default(0.35),
  /**
   * FILTRO RETRÔ (16 bits). Pós-processamento sobre a cena 3D — não mexe em
   * asset, material nem geometria, então é reversível trocando o modo:
   *  • "off"   — render normal
   *  • "pixel" — só pixelização (RenderPixelatedPass, com realce de borda) e
   *              texturas em NearestFilter
   *  • "16bit" — o de cima + paleta RGB565 (32/64/32 níveis) e dithering
   *  • "8bit"  — idem, mas RGB332 (8/8/4 = 256 cores), bem mais chapado
   * A paleta sai do MODO, não de um número solto: 16 e 8 bits são formatos com
   * níveis diferentes por canal (o olho enxerga mais verde, e os consoles
   * gastavam bits nele) — um "níveis de cor" único não representa isso.
   * Ver apps/game/src/scene/RetroFilter.tsx.
   */
  retroMode: z.enum(["off", "pixel", "8bit", "16bit"]).default("off"),
  /** tamanho do "pixelão" em pixels de tela (1 = sem pixelizar). Os valores
   * oferecidos no admin são fixos (2..24) — no meio-termo o padrão de pixel
   * fica irregular na diagonal. */
  retroPixelSize: z.number().int().min(1).max(24).default(6),
  /** dithering ordenado (Bayer 4×4) — tira o faixamento do céu/névoa */
  retroDither: z.boolean().default(true),
  /** névoa — distância onde começa a desbotar (≈45 células) */
  fogNear: z.number().nonnegative().default(90),
  /** névoa — distância onde fica totalmente opaca (nada visível além). Tem que
   * ficar DENTRO do renderDistance, senão a borda do terreno aparece recortada
   * contra o céu em vez de sumir na névoa. */
  fogFar: z.number().positive().default(135),
});
export type GameplayConfig = z.infer<typeof GameplayConfigSchema>;

export const ServerConfigSchema = z.object({
  expRateBase: z.number().positive().default(1),
  expRateJob: z.number().positive().default(1),
  dropRate: z.number().positive().default(1),
  dropRateOverrides: z.array(RateOverrideSchema).default([]),
  expRateOverrides: z.array(RateOverrideSchema).default([]),
  /** default movement mode for new characters; per-character override allowed */
  defaultMovementMode: z.enum(["grid", "free"]).default("grid"),
  allowMovementModeSwitch: z.boolean().default(true),
  /** ajustes do cliente 3D (editor do game) — todos com default */
  gameplay: GameplayConfigSchema.default({}),
  /** bump a cada save; engine-core usa pra detectar hot-reload sem restart */
  version: z.number().int().default(1),
  updatedAt: z.string(),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
