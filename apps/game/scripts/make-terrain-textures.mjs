// @ts-check
/**
 * Produz as texturas de chão do terreno QUADRADO (mapas do rAthena).
 *
 *   pnpm --filter @ragnarok/game terrain:textures
 *
 * Duas fontes, na ordem:
 *
 * 1. **Foto CC0** de `assets-new/terrain-cc0/<slot>/<conjunto>/` (Poly Haven e
 *    ambientCG, 4K). Passa pela ESTILIZAÇÃO abaixo antes de virar textura.
 * 2. **Receita procedural**, quando não há fonte para o slot — foi assim que
 *    todas nasceram, e continua sendo o caminho para grama/água enquanto não
 *    houver material CC0 bom para elas.
 *
 * Três regras valem para as duas fontes:
 *
 * 1. **Seamless obrigatório.** O material amostra por COORDENADA DE MUNDO
 *    (`vGroundWorld.xz`), não por UV de malha — não há costura de chunk para
 *    esconder emenda. O ruído procedural é calculado num lattice ENVOLVENTE e
 *    todo voronoi mede distância no toro; as fotos do Poly Haven/ambientCG já
 *    vêm tileáveis de fábrica.
 * 2. **Contraste baixo (±10% de luminância).** É o "um pouco mais suave" do
 *    change.txt. Contraste alto vira granulado quando a câmera afasta, que é o
 *    oposto do look pintado — e é justamente o que uma foto crua faz.
 * 3. **Cor base = a paleta que o projeto já usa** (`grid/terrainTextures.ts`).
 *    O shader divide o texel por essa base e usa o resultado como PADRÃO, não
 *    como cor: se a média da imagem não for a cor base, a textura TINGE o chão
 *    inteiro. Por isso a estilização termina normalizando a média.
 *
 * O PNG é escrito à mão (zlib do próprio Node); o `sharp` entra só para decodar
 * os JPEG 4K das fontes CC0, e sem ele o script ainda roda pelo caminho
 * procedural.
 */

import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "assets", "terrain");
const THUMB_DIR = join(OUT_DIR, "thumb");
const CC0_DIR = join(__dirname, "..", "..", "..", "assets-new", "terrain-cc0");

/** lado em pixels. 512 é o suficiente: a textura repete a cada 8 unidades de
 * mundo (4 células), então 512 dá ~64 px por célula na escala nativa. */
const SIZE = 512;

/**
 * Lado da miniatura que o editor mostra ao lado do nome da superfície.
 *
 * Precisa DIVIDIR `SIZE` exatamente. Com 96 (512/96 = 5,33) a redução somava
 * 6×6 amostras e dividia por 5,33² = 28,4: o resultado passava de 255 e o
 * `Buffer` grava módulo 256 — a neve, que é quase branca, dava a volta e saía
 * PRETA na paleta.
 */
const THUMB = 128;

/**
 * Todas as variantes que o editor pode oferecer, por superfície.
 *
 * A PRIMEIRA de cada lista é o padrão do cliente (o arquivo `<slot>.png`); as
 * outras viram `<slot>-<conjunto>.png` e só são baixadas se o mapa pedir. O
 * catálogo das pastas está em `assets-new/terrain-cc0/LEIA-ME.md`.
 *
 * `null` = receita procedural. Grama abre com ela de propósito: nenhum dos três
 * conjuntos de `grama/` é grama de verdade (são chão com musgo fotografado de
 * cima) e todos saem mais sujos que a receita — mas ficam na lista, porque quem
 * autora o mapa é que decide.
 */
const VARIANTES = {
  grass: [null, "grama/aerial_rocks_01", "grama/aerial_rocks_04", "grama/coast_sand_rocks_02"],
  dirt: [
    "terra/baseball_playground",
    "terra/brown_mud_dry",
    "terra/brown_mud_02",
    "terra/leaves_forest_ground",
    null,
  ],
  stone: [
    "pedra/coral_fort_wall_03",
    "pedra/rock_boulder_cracked",
    "pedra/Rock034",
    "pedra/Rock033",
    "pedra/broken_wall",
    null,
  ],
  sand: ["areia/coast_sand_01", null],
  snow: ["neve/Snow001", "neve/snow_field_aerial", "neve/snow_covered_ground-4K", null],
};

/** rótulo legível de cada conjunto, para o seletor do editor */
const ROTULOS = {
  null: "Procedural (gerada)",
  "grama/aerial_rocks_01": "Musgo com seixos",
  "grama/aerial_rocks_04": "Musgo escuro",
  "grama/coast_sand_rocks_02": "Musgo e pedras",
  "terra/baseball_playground": "Terra batida lisa",
  "terra/brown_mud_dry": "Terra com cascalho",
  "terra/brown_mud_02": "Lama escura",
  "terra/leaves_forest_ground": "Folhas secas",
  "pedra/coral_fort_wall_03": "Rocha áspera",
  "pedra/rock_boulder_cracked": "Rocha rachada clara",
  "pedra/Rock034": "Rocha com líquen",
  "pedra/Rock033": "Rocha escura",
  "pedra/broken_wall": "Alvenaria de pedra",
  "areia/coast_sand_01": "Areia de praia",
  "neve/Snow001": "Neve lisa",
  "neve/snow_field_aerial": "Campo nevado",
  "neve/snow_covered_ground-4K": "Neve com relevo",
  "agua/Water_01": "Aquarela funda",
  "agua/Water_02": "Aquarela clara",
  "agua/Water_03": "Aquarela esverdeada",
  "agua/Water_04": "Aquarela suave",
};

/**
 * Unidades de MUNDO por repetição, por superfície.
 *
 * A célula do rAthena mede 2 unidades e o personagem ocupa ~1 célula. Com as 8
 * unidades que valiam para tudo, o padrão repetia a cada 4 personagens: de cima,
 * na distância de câmera do jogo, isso vira granulado e o chão lê como COR
 * SÓLIDA. Escalas maiores devolvem a mancha visível.
 *
 * Não é o mesmo número para todas porque o conteúdo é outro: rocha tem estrutura
 * grande (placas), areia é quase uniforme e aguenta repetir mais miúdo.
 *
 * O mapa pode sobrescrever célula por célula em `terrainStyle[superfície].scale`
 * — o editor tem um slider por superfície.
 */
const ESCALA_PADRAO = {
  grass: 24,
  dirt: 20,
  stone: 28,
  sand: 18,
  snow: 24,
  water: 12,
  river: 12,
};

/**
 * Quanto a foto é puxada para a paleta do projeto.
 *
 * Foto crua não convive com prop low-poly de cor chapada: fica um chão
 * fotográfico embaixo de uma árvore de desenho. Estes três números são o dial —
 * 0 mantém a foto como está, 1 a achata completamente na cor base.
 */
const ESTILO = {
  /** quanto o matiz de cada pixel é puxado para o matiz base */
  matiz: 0.75,
  /** quanto a saturação é puxada para a da cor base */
  saturacao: 0.78,
  /**
   * Amplitude de luminância ALVO, como fração da luminância base.
   *
   * É um alvo, não um fator: um fator fixo dava 28% na terra lisa e 79% na
   * rocha, porque a faixa dinâmica de cada foto é outra — e 79% é exatamente o
   * granulado que a regra do contraste baixo existe para evitar. Medindo a
   * faixa da fonte e escalando para cá, toda textura sai com o mesmo peso
   * visual, venha de onde vier.
   */
  amplitude: 0.28,
};

// ---------------------------------------------------------------- PNG (8 bits)

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** PNG RGB de 8 bits, sem filtro por linha (filtro 0) — o deflate resolve. */
function writePng(path, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

// ------------------------------------------------------------------- aleatório

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- ruído (tileável)

const suave = (t) => t * t * (3 - 2 * t);

/** lattice n×n de valores 0..1; a envolvência vem do `% n` na amostragem */
function lattice(n, rnd) {
  const a = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = rnd();
  return a;
}

/** value noise bilinear em (u,v) ∈ [0,1), envolvente nas duas pontas */
function noise2(u, v, n, lat) {
  const x = u * n;
  const y = v * n;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = suave(x - x0);
  const fy = suave(y - y0);
  const i0 = ((x0 % n) + n) % n;
  const j0 = ((y0 % n) + n) % n;
  const i1 = (i0 + 1) % n;
  const j1 = (j0 + 1) % n;
  const a = lat[j0 * n + i0];
  const b = lat[j0 * n + i1];
  const c = lat[j1 * n + i0];
  const d = lat[j1 * n + i1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * fbm de N oitavas. Cada oitava dobra o lattice — e como todo lattice divide
 * 512 exatamente, todas ladrilham juntas. Devolve algo centrado em ~0,5.
 */
function makeFbm(base, oitavas, rnd) {
  const camadas = [];
  let n = base;
  let amp = 1;
  let soma = 0;
  for (let o = 0; o < oitavas; o++) {
    camadas.push({ n, lat: lattice(n, rnd), amp });
    soma += amp;
    n *= 2;
    amp *= 0.5;
  }
  return (u, v) => {
    let acc = 0;
    for (const c of camadas) acc += noise2(u, v, c.n, c.lat) * c.amp;
    return acc / soma;
  };
}

/** ruído esticado num eixo (estrias) — o lattice é retangular, e envolve igual */
function makeStreak(nx, ny, rnd) {
  const lat = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) lat[i] = rnd();
  return (u, v) => {
    const x = u * nx;
    const y = v * ny;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = suave(x - x0);
    const fy = suave(y - y0);
    const i0 = ((x0 % nx) + nx) % nx;
    const j0 = ((y0 % ny) + ny) % ny;
    const i1 = (i0 + 1) % nx;
    const j1 = (j0 + 1) % ny;
    const a = lat[j0 * nx + i0];
    const b = lat[j0 * nx + i1];
    const c = lat[j1 * nx + i0];
    const d = lat[j1 * nx + i1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

/**
 * Voronoi de grade jitterada, g×g células.
 *
 * Devolve `{ f1, f2, id }` em unidades de CÉLULA (f1 = distância ao ponto mais
 * próximo). A envolvência sai do `% g` ao buscar o vizinho: um ponto na coluna
 * 0 é visto como vizinho da coluna g−1, então a mancha atravessa a emenda.
 */
function makeVoronoi(g, rnd) {
  const px = new Float32Array(g * g);
  const py = new Float32Array(g * g);
  const val = new Float32Array(g * g);
  for (let i = 0; i < g * g; i++) {
    px[i] = 0.15 + rnd() * 0.7;
    py[i] = 0.15 + rnd() * 0.7;
    val[i] = rnd();
  }
  return (u, v) => {
    const x = u * g;
    const y = v * g;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 1e9;
    let f2 = 1e9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = (((cx + dx) % g) + g) % g;
        const gy = (((cy + dy) % g) + g) % g;
        const k = gy * g + gx;
        const ddx = cx + dx + px[k] - x;
        const ddy = cy + dy + py[k] - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = k;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, v: val[id] };
  };
}

// ------------------------------------------------------------------ cor (HSL)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Seixo: disco claro com ARO ESCURO em volta.
 *
 * Sem o aro, um disco só clareado e dessaturado sobre base quente lê como
 * mancha AZUL — é contraste simultâneo, não erro de matiz (o HSL nem mexe no
 * tom). O aro devolve o volume e é o que faz a pedrinha parecer apoiada no
 * chão, como nas esferas 2 e 5 do `reftexture.png`.
 *
 * `raro` = valor mínimo da célula para virar seixo (0,84 ≈ 16% das células).
 */
function seixo(s, raro, r) {
  if (s.v <= raro) return { dl: 0, ds: 0 };
  const d = s.f1 / r;
  if (d > 1.35) return { dl: 0, ds: 0 };
  if (d > 1) return { dl: -0.055 * (1 - (d - 1) / 0.35), ds: 0 }; // aro/sombra
  const corpo = 1 - d * d;
  return { dl: 0.065 * corpo, ds: -0.05 * corpo };
}

// ------------------------------------------------------------------- receitas

/**
 * Cada receita devolve, por pixel, os DESVIOS de matiz/saturação/luminância em
 * cima da cor base. Trabalhar em HSL (e não em RGB) é o que mantém a família de
 * tons coerente: clarear grama não a deixa esbranquiçada, e a deriva de matiz
 * anda no eixo amarelo↔verde em vez de escorregar para o azul.
 */
const RECEITAS = {
  /**
   * Grama: mottling largo + tufos de folha por voronoi (a esfera 1 e a 4 do
   * `reftexture.png`). A deriva de matiz por tufo é o que impede o campo de
   * virar um verde chapado só com variação de brilho.
   */
  grass: {
    base: "#7d9b3f",
    build(rnd) {
      const fbmLargo = makeFbm(3, 4, rnd);
      const fbmFino = makeFbm(28, 2, rnd);
      const tufos = makeVoronoi(11, rnd);
      return (u, v) => {
        const m = fbmLargo(u, v) - 0.5;
        const f = fbmFino(u, v) - 0.5;
        const t = tufos(u, v);
        // O tufo entra pelo VALOR da célula (mancha inteira mais clara ou mais
        // fechada), não por um disco em volta do ponto: com o disco a grama
        // ficava borbulhada, como bolor. `f1` só suaviza a beirada.
        const beira = Math.min(1, t.f1 / 0.7);
        const mancha = (t.v - 0.5) * (0.35 + 0.65 * (1 - beira));
        return {
          dh: mancha * 0.020 + m * 0.010,
          ds: mancha * 0.07 + m * 0.04,
          dl: m * 0.075 + f * 0.022 + mancha * 0.055,
        };
      };
    },
  },

  /**
   * Terra batida: estrias na direção do desgaste + seixos claros esparsos
   * (esfera 2 da referência).
   */
  dirt: {
    base: "#8a6b45",
    build(rnd) {
      const fbmLargo = makeFbm(6, 3, rnd);
      // estria LARGA e fraca: com lattice fino em x (48×8) o resultado era
      // listra vertical dura — lia como veio de madeira, não como terra pisada
      const estrias = makeStreak(9, 4, rnd);
      const seixos = makeVoronoi(22, rnd);
      return (u, v) => {
        const m = fbmLargo(u, v) - 0.5;
        const e = estrias(u, v) - 0.5;
        const s = seixos(u, v);
        const p = seixo(s, 0.84, 0.2);
        return {
          dh: m * 0.006,
          ds: m * 0.04 + p.ds,
          dl: m * 0.08 + e * 0.03 + p.dl,
        };
      };
    },
  },

  /**
   * Rocha: placas de voronoi com ARESTA ESCURA — é a esfera 3 da referência, e
   * é o que faz a saia vertical da montanha ler como pedra quebrada em vez de
   * cinza liso. Duas escalas de placa (grande e miúda) para não virar padrão.
   */
  stone: {
    base: "#7c7f86",
    build(rnd) {
      const placas = makeVoronoi(9, rnd);
      const lascas = makeVoronoi(22, rnd);
      const fbmFino = makeFbm(24, 3, rnd);
      return (u, v) => {
        const p = placas(u, v);
        const l = lascas(u, v);
        const f = fbmFino(u, v) - 0.5;
        // f2 − f1 pequeno = está perto da fronteira entre duas placas = fenda
        const fenda = 1 - Math.min(1, (p.f2 - p.f1) / 0.16);
        const fendaFina = 1 - Math.min(1, (l.f2 - l.f1) / 0.10);
        return {
          dh: (p.v - 0.5) * 0.008,
          ds: (p.v - 0.5) * 0.03,
          dl: (p.v - 0.5) * 0.085 + (l.v - 0.5) * 0.03 + f * 0.03 - fenda * 0.16 - fendaFina * 0.05,
        };
      };
    },
  },

  /** Areia: grão fino, quase sem variação de matiz, com seixos raros. */
  sand: {
    base: "#c9b380",
    build(rnd) {
      const fbmLargo = makeFbm(5, 3, rnd);
      const grao = makeFbm(64, 2, rnd);
      const seixos = makeVoronoi(26, rnd);
      return (u, v) => {
        const m = fbmLargo(u, v) - 0.5;
        const g = grao(u, v) - 0.5;
        const p = seixo(seixos(u, v), 0.88, 0.17);
        return {
          dh: m * 0.004,
          ds: m * 0.03 + p.ds,
          dl: m * 0.055 + g * 0.03 + p.dl,
        };
      };
    },
  },

  /** Neve: só luminância, dunas largas — cor é o que menos varia na neve. */
  snow: {
    base: "#e8ecef",
    build(rnd) {
      const dunas = makeFbm(4, 3, rnd);
      const fino = makeFbm(40, 2, rnd);
      return (u, v) => {
        const d = dunas(u, v) - 0.5;
        const f = fino(u, v) - 0.5;
        return { dh: 0, ds: d * 0.02, dl: d * 0.055 + f * 0.02 };
      };
    },
  },
};

// ------------------------------------------------------- fontes CC0 (fotos)

/**
 * `sharp` só para DECODAR os JPEG 4K.
 *
 * Ele não é dependência declarada de nenhum pacote do workspace, então
 * `require("sharp")` não resolve — só o caminho interno do pnpm resolve. A
 * versão é procurada em vez de cravada, senão um bump de patch quebra o script.
 * Falhou? O slot cai no procedural e o script continua.
 */
function carregarSharp() {
  try {
    const require = createRequire(join(__dirname, "..", "..", "..", "package.json"));
    const pnpm = join(__dirname, "..", "..", "..", "node_modules", ".pnpm");
    const dir = readdirSync(pnpm).find((d) => /^sharp@/.test(d));
    if (!dir) return null;
    return require(join(pnpm, dir, "node_modules", "sharp"));
  } catch (err) {
    console.warn("[terrain] sharp indisponível, tudo procedural:", err.message);
    return null;
  }
}

/** o mapa de COR do conjunto (Poly Haven usa `_diff_`/`_col_`, ambientCG `_Color`) */
function mapaDeCor(pasta) {
  if (!existsSync(pasta)) return null;
  const f = readdirSync(pasta).find((n) => /(_diff_|_col_|_Color|Base Color)/i.test(n) && /\.(jpg|jpeg|png)$/i.test(n));
  return f ? join(pasta, f) : null;
}

/**
 * Foto 4K → textura do jogo: reamostra para 512 e ESTILIZA.
 *
 * A estilização é o que faz uma foto conviver com prop low-poly. Em HSL, para
 * mexer em matiz/saturação/luminância sem embaralhar a cor:
 *
 *  • **matiz** puxado para o da cor base — tira o desvio de cor da fotografia
 *    (a areia do Poly Haven puxa para o rosa, a rocha para o azul);
 *  • **saturação** puxada para a da base, pelo mesmo motivo;
 *  • **contraste comprimido** em torno da média — é o que transforma o
 *    granulado fotográfico no mottling largo da referência;
 *  • **média normalizada na cor base**, obrigatório: o shader faz
 *    `texel / corBase`, então uma média diferente tingiria o chão inteiro.
 */
async function daFoto(sharp, arquivo, base) {
  const { data } = await sharp(arquivo)
    .resize(SIZE, SIZE, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [bh, bs, bl] = base;
  const n = SIZE * SIZE;

  // primeira passada: HSL de cada pixel e a média da luminância
  const h = new Float32Array(n);
  const s = new Float32Array(n);
  const l = new Float32Array(n);
  let somaL = 0;
  for (let i = 0; i < n; i++) {
    const [ph, ps, pl] = rgbToHsl(data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255);
    h[i] = ph;
    s[i] = ps;
    l[i] = pl;
    somaL += pl;
  }
  const mediaL = somaL / n;

  /**
   * Fator de contraste medido na PRÓPRIA foto, por percentil.
   *
   * p2..p98 em vez de min..max porque um único pixel especular (um brilho na
   * pedra molhada) definiria a faixa inteira e achataria todo o resto. Os 4%
   * de fora são CORTADOS na segunda passada, não só ignorados: sem o corte a
   * amplitude final continuava sendo a dos extremos, e numa fonte lisa (onde o
   * fator satura em 1) o resultado saía com o contraste da foto crua.
   */
  const ordenada = Float32Array.from(l).sort();
  const p2 = ordenada[Math.floor(n * 0.02)];
  const p98 = ordenada[Math.floor(n * 0.98)];
  const faixa = Math.max(1e-4, p98 - p2);
  const contraste = Math.min(1, (ESTILO.amplitude * bl) / faixa);

  // segunda passada: aplica o estilo
  const rgb = Buffer.alloc(n * 3);
  let somaR = 0;
  let somaG = 0;
  let somaB = 0;
  for (let i = 0; i < n; i++) {
    // menor caminho no círculo de matiz — senão um pixel em 0,99 seria puxado
    // por todo o círculo até 0,05 e passaria por cores que não existem na foto
    let d = h[i] - bh;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    const hh = (bh + d * (1 - ESTILO.matiz) + 1) % 1;
    const ss = clamp01(bs + (s[i] - bs) * (1 - ESTILO.saturacao));
    const lc = Math.min(p98, Math.max(p2, l[i]));
    const ll = clamp01(bl + (lc - mediaL) * contraste);
    const [r, g, b] = hslToRgb(hh, ss, ll);
    rgb[i * 3] = Math.round(clamp01(r) * 255);
    rgb[i * 3 + 1] = Math.round(clamp01(g) * 255);
    rgb[i * 3 + 2] = Math.round(clamp01(b) * 255);
    somaR += rgb[i * 3];
    somaG += rgb[i * 3 + 1];
    somaB += rgb[i * 3 + 2];
  }

  // normaliza a MÉDIA na cor base (ganho por canal)
  const [br, bg, bb] = hslToRgb(bh, bs, bl).map((v) => v * 255);
  const gr = br / Math.max(1, somaR / n);
  const gg = bg / Math.max(1, somaG / n);
  const gb = bb / Math.max(1, somaB / n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = Math.min(255, Math.round(rgb[i * 3] * gr));
    rgb[i * 3 + 1] = Math.min(255, Math.round(rgb[i * 3 + 1] * gg));
    rgb[i * 3 + 2] = Math.min(255, Math.round(rgb[i * 3 + 2] * gb));
  }
  return rgb;
}

/** reduz um RGB de SIZE² para THUMB², por média de bloco (a miniatura do editor) */
function miniatura(rgb) {
  const k = SIZE / THUMB;
  const out = Buffer.alloc(THUMB * THUMB * 3);
  for (let y = 0; y < THUMB; y++) {
    for (let x = 0; x < THUMB; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const o = (((y * k + dy) | 0) * SIZE + ((x * k + dx) | 0)) * 3;
          r += rgb[o];
          g += rgb[o + 1];
          b += rgb[o + 2];
          n++;
        }
      }
      const o = (y * THUMB + x) * 3;
      // divide pelo que foi SOMADO e ainda satura: `Buffer` grava módulo 256, e
      // um estouro aqui não aparece como clareamento, aparece como cor invertida
      out[o] = Math.min(255, Math.round(r / n));
      out[o + 1] = Math.min(255, Math.round(g / n));
      out[o + 2] = Math.min(255, Math.round(b / n));
    }
  }
  return out;
}

// ----------------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(THUMB_DIR, { recursive: true });

const sharp = carregarSharp();
let seed = 0x5eed;
const linhas = [];
/** manifesto que o editor lê para montar o seletor de textura */
const manifesto = { escalaPadrao: ESCALA_PADRAO, superficies: {} };

for (const [nome, receita] of Object.entries(RECEITAS)) {
  const [br0, bg0, bb0] = hexToRgb(receita.base);
  const [bh, bs, bl] = rgbToHsl(br0, bg0, bb0);
  manifesto.superficies[nome] = [];

  const variantes = VARIANTES[nome] ?? [null];
  for (let v = 0; v < variantes.length; v++) {
    const conjunto = variantes[v];
    // a PRIMEIRA variante é o padrão e fica com o nome curto — é o arquivo que
    // um mapa sem `terrainStyle` carrega
    const id = v === 0 ? nome : `${nome}-${conjunto ? conjunto.split("/")[1] : "procedural"}`;
    const arquivo = sharp && conjunto ? mapaDeCor(join(CC0_DIR, conjunto)) : null;

    let rgb;
    let fonte;
    if (arquivo) {
      rgb = await daFoto(sharp, arquivo, [bh, bs, bl]);
      fonte = conjunto;
    } else {
      if (conjunto) {
        // fonte declarada mas ausente do disco: some da lista em vez de virar
        // uma entrada que o editor oferece e o cliente não consegue carregar
        console.warn(`[terrain] fonte de ${id} não encontrada (${conjunto}) — pulando`);
        continue;
      }
      const rnd = mulberry32((seed = (seed * 1103515245 + 12345) >>> 0));
      const campo = receita.build(rnd);
      rgb = Buffer.alloc(SIZE * SIZE * 3);
      for (let y = 0; y < SIZE; y++) {
        const vv = y / SIZE;
        for (let x = 0; x < SIZE; x++) {
          const u = x / SIZE;
          const d = campo(u, vv);
          const [r, g, b] = hslToRgb((bh + d.dh + 1) % 1, clamp01(bs + d.ds), clamp01(bl + d.dl));
          const o = (y * SIZE + x) * 3;
          rgb[o] = Math.round(clamp01(r) * 255);
          rgb[o + 1] = Math.round(clamp01(g) * 255);
          rgb[o + 2] = Math.round(clamp01(b) * 255);
        }
      }
      fonte = "procedural";
    }

    // amplitude de luminância medida no resultado FINAL — é o número que diz se
    // a regra do "contraste baixo" foi respeitada, valha a fonte que valer
    let min = 1;
    let max = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const l = rgbToHsl(rgb[i * 3] / 255, rgb[i * 3 + 1] / 255, rgb[i * 3 + 2] / 255)[2];
      if (l < min) min = l;
      if (l > max) max = l;
    }

    const bytes = writePng(join(OUT_DIR, `${id}.png`), SIZE, SIZE, rgb);
    writePng(join(THUMB_DIR, `${id}.png`), THUMB, THUMB, miniatura(rgb));
    manifesto.superficies[nome].push({ id, rotulo: ROTULOS[String(conjunto)] ?? id, fonte });
    linhas.push({
      textura: `${id}.png`,
      fonte,
      padrao: v === 0 ? "sim" : "",
      "amplitude %": (((max - min) / bl) * 100).toFixed(1),
      KB: (bytes / 1024).toFixed(1),
    });
  }
}

/**
 * ÁGUA: a textura entra como PADRÃO NEUTRO, não como cor.
 *
 * A lâmina é material próprio (`SquareTerrain.makeWaterMaterial`) e a cor dela
 * vem da PROFUNDIDADE do leito — turquesa no raso, azul escuro no fundo. Se a
 * textura trouxesse a própria cor, ela apagaria essa leitura, que é o que faz o
 * canal bloqueado parecer intransponível antes de o jogador tentar.
 *
 * Por isso o arquivo sai com a média em CINZA NEUTRO: cada pixel guarda só a
 * razão em relação à média, e o shader multiplica. A variação de matiz da
 * aquarela sobrevive (um pixel mais esverdeado que a média continua mais
 * esverdeado), a cor absoluta não.
 *
 * A MINIATURA, essa sim, é a aquarela original — é ela que o editor mostra para
 * escolher, e mostrar um cinza não ajudaria ninguém.
 */
const AGUA_DIR = join(CC0_DIR, "agua");
manifesto.superficies.water = [];
if (sharp && existsSync(AGUA_DIR)) {
  const arquivos = readdirSync(AGUA_DIR).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  for (let v = 0; v < arquivos.length; v++) {
    const nome = arquivos[v].replace(/\.[^.]+$/, "");
    const id = v === 0 ? "water" : `water-${nome}`;
    const { data } = await sharp(join(AGUA_DIR, arquivos[v]))
      .resize(SIZE, SIZE, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const n = SIZE * SIZE;
    const somas = [0, 0, 0];
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) somas[c] += data[i * 3 + c];
      lum[i] = data[i * 3] * 0.299 + data[i * 3 + 1] * 0.587 + data[i * 3 + 2] * 0.114;
    }
    const medias = somas.map((s) => s / n);

    /**
     * Ganho de contraste MIRANDO uma amplitude, não um fator fixo.
     *
     * As quatro aquarelas do pack são lavadas suaves: a variação nativa vai de
     * 1,4% a 4,5% de luminância. Amortecida por um fator (o que eu fazia) e
     * amortecida de novo no shader, sobrava ~2% — a textura era amostrada e
     * simplesmente não se via, que é o "a textura da água não renderiza". Medir
     * a faixa de CADA arquivo e escalar para o mesmo alvo põe as quatro no mesmo
     * peso visual, venha a fonte que vier. É a mesma lição do chão.
     */
    const ALVO = 0.55; // amplitude p2..p98 da RAZÃO, em fração da média
    let mediaLum = 0;
    for (let i = 0; i < n; i++) mediaLum += lum[i];
    mediaLum /= n;
    /**
     * Percentis da RAZÃO (pixel ÷ média), não do valor bruto.
     *
     * Cortar o valor do CANAL por percentis de luminância achatava a imagem
     * inteira: num azul-petróleo o canal azul fica todo acima do p98 da
     * luminância, então todo pixel era grampeado no mesmo teto e a textura saía
     * lisa (medido: desvio caiu para 0,0%). A razão é adimensional e comparável
     * entre canais — é ela que tem de ser cortada.
     */
    const razoes = Float32Array.from(lum, (l) => l / mediaLum).sort();
    const r2 = razoes[Math.floor(n * 0.02)];
    const r98 = razoes[Math.floor(n * 0.98)];
    const ganho = ALVO / Math.max(1e-4, r98 - r2);

    const CENTRO = 128;
    const padrao = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const razao = Math.min(r98, Math.max(r2, data[i * 3 + c] / Math.max(1, medias[c])));
        padrao[i * 3 + c] = Math.max(0, Math.min(255, Math.round(CENTRO * (1 + (razao - 1) * ganho))));
      }
    }
    const bytes = writePng(join(OUT_DIR, `${id}.png`), SIZE, SIZE, padrao);

    const thumbRgb = await sharp(join(AGUA_DIR, arquivos[v]))
      .resize(THUMB, THUMB, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer();
    writePng(join(THUMB_DIR, `${id}.png`), THUMB, THUMB, Buffer.from(thumbRgb));

    manifesto.superficies.water.push({ id, rotulo: ROTULOS[`agua/${nome}`] ?? nome, fonte: `agua/${nome}` });
    linhas.push({ textura: `${id}.png`, fonte: `agua/${nome}`, padrao: v === 0 ? "sim" : "", "amplitude %": "—", KB: (bytes / 1024).toFixed(1) });
  }
}
// rio usa as mesmas variantes da água — é a mesma lâmina, muda só a profundidade
manifesto.superficies.river = manifesto.superficies.water;

writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifesto, null, 2));

console.table(linhas);
console.log(`\n${linhas.length} texturas em ${OUT_DIR}`);
console.log(`miniaturas (${THUMB}px) em ${THUMB_DIR}`);
