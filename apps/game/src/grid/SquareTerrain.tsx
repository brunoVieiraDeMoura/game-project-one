import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { GameplayConfig } from "@ragnarok/game-data";
import { GROUND_NOISE_GLSL } from "../scene/groundNoise.glsl";
import {
  buildChunkGeometry,
  buildWaterGeometry,
  bytesDaGeometria,
  chunkCenter,
  chunkCounts,
  chunksSujos,
  CHUNK_CELLS,
  type ChunkSource,
} from "./squareChunks";
import { SQUARE_SIZE } from "./squareGrid";
import { registrarBuild } from "../scene/perfProbe";
import { quadro, registrarEvento, somarChunk } from "../core/diagnostics/flightRecorder";
import { marcarChunk } from "../core/diagnostics/cenaProbe";
import { isolado } from "../core/diagnostics/isolamento";
import { useWorldStore } from "../net/worldStore";
import {
  TERRAIN_LAYERS,
  aplicarEstilo,
  escalaDe,
  escalasPorCamada,
  terrainArrayTexture,
  terrainBaseColors,
  varianteDeAgua,
} from "./terrainTextures";

/**
 * Quanto tempo, por QUADRO, se pode gastar montando geometria de chunk.
 *
 * 6 ms deixa folga dentro dos 16,6 ms de um quadro a 60 FPS mesmo somando o
 * resto da cena. Cada chunk custa ~2,5 ms (medido em 549 construções), então
 * entram dois por quadro e uma fileira nova de dez se resolve em cinco quadros
 * — sem o solavanco de 25 ms que dava ao cruzar a fronteira de visão.
 */
const ORCAMENTO_MS = 6;

/**
 * Põe a geometria NOVA no cache e descarta a que estava lá.
 *
 * A ordem é o ponto: a antiga só é liberada DEPOIS de a nova existir. Enquanto
 * ela existir, o chunk continua sendo desenhado — que é o que impede o buraco de
 * um quadro (o "quadrado cinza" ao criar ou desfazer algo grande).
 *
 * Serve ao chão e à água: a água pode ser `null` (chunk sem água nenhuma), e
 * `null` também é uma resposta — por isso o mapa é de `T`, não de geometria.
 */
function trocarGeometria<T extends THREE.BufferGeometry | null>(
  cache: Map<string, T>,
  key: string,
  nova: T,
): T {
  const antiga = cache.get(key);
  cache.set(key, nova);
  if (antiga && antiga !== nova) antiga.dispose();
  return nova;
}

/**
 * Quantas entidades caem dentro de um chunk (DEV, flight recorder).
 *
 * A pergunta que ela responde no laudo é "o quadro em que o personagem recuou
 * estava montando um pedaço de mapa CHEIO de bicho?". Sem a contagem, o evento
 * de chunk diria só "montei um" — e um chunk vazio de canto de mapa e um com
 * quinze mobs custam coisas muito diferentes ao quadro.
 *
 * A célula da entidade é a do SERVIDOR e a do chunk é a do mapa; no `/play` as
 * duas são a mesma grade (mapa do rAthena inteiro, `legacy.origin = 0,0`). Num
 * mapa autorado com janela elas divergiriam — mas ali não há sessão, e portanto
 * não há entidade.
 */
function entidadesNoChunk(cx: number, cz: number): number {
  const s = useWorldStore.getState();
  let n = 0;
  for (const gid of s.gids) {
    const e = s.entities[gid];
    if (!e) continue;
    if (Math.floor(e.x / CHUNK_CELLS) === cx && Math.floor(e.y / CHUNK_CELLS) === cz) n++;
  }
  return n;
}

/**
 * Teto de memória da PRÉ-CARGA do mapa inteiro.
 *
 * Construir todos os chunks antes de soltar o jogador acaba de vez com o custo
 * de andar — mas construir e DESENHAR são coisas diferentes, e só a primeira é
 * barata. No `prt_fild08` plano de hoje são 169 chunks × ~204 KB ≈ 35 MB, que
 * cabem folgados. O mesmo mapa cheio de relevo emite muito mais vértice (o
 * orçamento admite até 20.000 por chunk) e a projeção passa de 170 MB — aí a
 * pré-carga trocaria um engasgo por falta de memória.
 *
 * Por isso o tamanho REAL do primeiro chunk é medido (`bytesDaGeometria`) e
 * projetado para o mapa inteiro; acima deste teto a pré-carga desiste e o
 * streaming de sempre continua valendo, que é o comportamento seguro.
 */
const PRECARGA_MAX_BYTES = 64 * 1024 * 1024;

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
  precarregar = false,
  orcamentoMs = ORCAMENTO_MS,
  onProgresso,
}: {
  map: GameMap;
  center?: { x: number; z: number };
  radius?: number;
  ground?: GameplayConfig;
  /**
   * Constrói o mapa INTEIRO em segundo plano, não só o que está à vista.
   *
   * Só o `/play` liga isto. No editor seria o contrário de ajudar: cada
   * pincelada recria os arrays do mapa, a pré-carga recomeçaria do zero e o
   * editor passaria a reconstruir 169 chunks por gesto de mouse.
   */
  precarregar?: boolean;
  /**
   * Quanto tempo por quadro se pode gastar montando geometria.
   *
   * Existe por causa da TELA DE CARREGAMENTO: enquanto ela está no ar o quadro
   * não está mostrando jogo nenhum, então o orçamento de 6 ms — que existe para
   * não roubar tempo de um quadro que precisa desenhar — deixa de fazer sentido
   * e só faz a espera durar mais. Com a tela fora, volta ao default.
   */
  orcamentoMs?: number;
  /**
   * Avanço da pré-carga, para quem quiser mostrar progresso.
   *
   * Só é chamado quando o número MUDA, e só enquanto a fila da pré-carga existe
   * — em regime (fila vazia) não custa nada. `feitos === total` é o sinal de que
   * o mapa inteiro está pronto; ele também sai quando a pré-carga se desliga
   * sozinha por estouro de memória, senão quem espera esperaria para sempre.
   */
  onProgresso?: (feitos: number, total: number) => void;
}) {
  const cache = useRef(new Map<string, THREE.BufferGeometry>());
  const aguaCache = useRef(new Map<string, THREE.BufferGeometry | null>());
  /**
   * Chunks cuja geometria está DESATUALIZADA — desenhada, mas velha.
   *
   * Eles não estão "faltando": continuam no cache e continuam aparecendo. O que
   * este conjunto diz é "reconstrua e troque quando der". Ver o bloco de
   * invalidação, onde está o porquê de não descartar na hora.
   */
  const precisaRefazer = useRef<Set<string>>(new Set());
  /** chunks que entraram no alcance e ainda não couberam no orçamento */
  const porConstruir = useRef<{ key: string; cx: number; cz: number; d2: number }[]>([]);
  /** o conjunto desenhado na passada anterior — só para o flight recorder (DEV) */
  const visiveisAnterior = useRef<Set<string>>(new Set());
  /**
   * Fila da pré-carga: o mapa inteiro, em segundo plano.
   *
   * Separada da `porConstruir` de propósito. Aquela é REFEITA a cada passada do
   * `useMemo` abaixo (`porConstruir.current = fila.concat(adiantar)`), então
   * misturar as duas faria a pré-carga ser jogada fora a cada vez que o centro
   * de visão mudasse. E a prioridade tem de ser mesmo dela: primeiro o que está
   * sendo olhado, depois o resto do mapa nos quadros que sobram.
   */
  const filaPrecarga = useRef<{ key: string; cx: number; cz: number }[]>([]);
  /** quantos chunks a pré-carga tinha para fazer (denominador do progresso) */
  const totalPrecarga = useRef(0);
  /** último progresso publicado — não chamar o callback sem que nada tenha andado */
  const progressoPublicado = useRef(-1);
  /** contador que reabre o `useMemo` quando a fila avança (ver lá embaixo) */
  const [versao, setVersao] = useState(0);
  // de quais arrays as geometrias em cache foram construídas
  const fonte = useRef<ChunkSource | null>(null);
  // A escolha de textura/escala é do MAPA (`terrainStyle`, autorada no editor).
  // `JSON.stringify` como dep porque o objeto é recriado a cada edição do store,
  // e refazer o material a cada pincelada recompilaria o shader.
  const estilo = map.terrainStyle;
  const estiloKey = JSON.stringify(estilo ?? {});
  const material = useMemo(
    () => makeSquareGroundMaterial(ground, estilo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ground?.groundTextureScale, ground?.groundTextureStrength, ground?.groundMode, estiloKey],
  );
  const materialAgua = useMemo(
    () => makeWaterMaterial(estilo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estiloKey],
  );

  /**
   * Devolve os materiais quando eles são TROCADOS ou quando o componente sai.
   *
   * A limpeza do cache lá embaixo descartava só as geometrias, e os dois
   * materiais vinham de `useMemo` — ou seja, cada troca de mapa deixava dois
   * para trás, com o programa compilado atrás deles. E não é só no desmonte:
   * mudar o estilo do terreno no editor recria o material pelas dependências do
   * memo, e o anterior vazava do mesmo jeito.
   *
   * Um efeito por material, com ele na dependência, cobre os dois casos — o
   * mesmo padrão que o `GlowChao` já usa e pela mesma razão: quem criou é quem
   * destrói, porque o R3F só descarta o que ELE construiu.
   *
   * **Sobrevive ao StrictMode porque `Material.dispose()` é REVERSÍVEL**, a
   * mesma propriedade que já justifica o `Skeleton.dispose()` do `assets.ts`:
   * ele só solta o programa compilado, e o `WebGLRenderer` o reconstrói na
   * primeira vez que for desenhar de novo. O remonte simulado do DEV custa, no
   * pior caso, uma recompilação — e ela é observável, na coluna `programas` do
   * flight recorder e na linha `geo/tex/prog` do F9. Algo IRREVERSÍVEL aqui
   * (descartar geometria em uso, por exemplo) deixaria o chão sumir depois do
   * primeiro remonte, que é o defeito clássico deste projeto.
   */
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => materialAgua.dispose(), [materialAgua]);

  // Troca de variante recarrega SÓ a camada que mudou, no mesmo array texture —
  // sem reconstruir geometria nem material.
  useEffect(() => {
    void aplicarEstilo(estilo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estiloKey]);

  /**
   * Enche a fila da pré-carga com o mapa inteiro.
   *
   * Só quando `precarregar` está ligado (o `/play`). A dependência é a
   * IDENTIDADE dos arrays do mapa, a mesma que invalida os chunks logo abaixo:
   * trocar de mapa refaz a fila, e no `/play` esses arrays não mudam depois da
   * carga.
   */
  useEffect(() => {
    if (!precarregar) {
      filaPrecarga.current = [];
      totalPrecarga.current = 0;
      return;
    }
    const { cols, rows } = chunkCounts(map);
    const todos: { key: string; cx: number; cz: number }[] = [];
    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) todos.push({ key: `${cx},${cz}`, cx, cz });
    }
    filaPrecarga.current = todos;
    totalPrecarga.current = todos.length;
    progressoPublicado.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precarregar, map, map.collision, map.surface, map.heightmap]);

  // Só a água anima. O uniform é mutado direto (não passa por `setState`):
  // repintar o React 60×/s por causa de uma onda seria o mesmo erro que o
  // cronômetro de recarga da barra de skills já evita.
  useFrame((_, dt) => {
    // `?iso=semAgua` congela a onda pro teste A/B ("WATER STATIC" vs
    // "WATER ANIMATED") sem trocar de material nem remontar chunk
    if (isolado("semAgua")) return;
    const u = (materialAgua as MaterialComTempo).uTempo;
    if (u) u.value += dt;
  });

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
      const sujos = chunksSujos(map, anterior, atual);
      /**
       * CONSTRÓI ANTES DE TROCAR — o chunk sujo NÃO sai do desenho.
       *
       * Era daqui que saía o "quadrado cinza ao criar ou desfazer algo grande":
       * o código descartava e apagava do cache TODOS os sujos de uma vez, e a
       * reconstrução tem orçamento de `orcamentoMs` por quadro. Entre o descarte
       * e a reconstrução o chunk simplesmente não existia, e o que aparecia no
       * lugar dele era o vazio. Desfazer troca os três arrays de uma vez, o que
       * suja o mapa INTEIRO — daí o buraco ser grande.
       *
       * Agora o sujo é só ANOTADO. A geometria velha continua no cache e
       * continua sendo desenhada; quem constrói (o `useFrame` que drena a fila,
       * ou esta mesma passada se couber no orçamento) troca e descarta a antiga
       * na hora da troca. Um quadro de terreno desatualizado é invisível; um
       * buraco não é.
       */
      for (const key of sujos) precisaRefazer.current.add(key);
      /**
       * A INVALIDAÇÃO — o único caminho de liberação no `/play`, junto com o
       * desmonte.
       *
       * Registrada mesmo sendo rara (ela nasce de EDIÇÃO de mapa, que não
       * acontece com sessão aberta) porque é o que permite DESCARTAR a hipótese
       * "o rollback foi o chunk sendo liberado": num caso capturado sem este
       * evento, ela cai por falta de fato, não por opinião. Sair do alcance de
       * visão NÃO passa por aqui — culling tira do desenho e não libera nada.
       *
       * "invalidou" e não mais "descartou": o descarte agora acontece na TROCA,
       * um chunk por vez, e pode demorar vários quadros para chegar em todos.
       */
      if (sujos.length > 0) registrarEvento("chunks", "invalidou", { quantos: sujos.length, chunks: sujos.join(" ") });
      /**
       * Poda os chunks que ficaram FORA da grade, se o mapa encolheu.
       *
       * `resizeMap` reduzindo width/height muda `chunkCounts(map)`, e o laço
       * de desenho abaixo só percorre `cx,cz` dentro do intervalo novo — mas
       * sem isto, `cache`/`aguaCache` nunca perdiam as entradas de fora: cada
       * experimento de encolher o mapa (painel Vegetação, no editor) deixava
       * geometria presa na GPU até o componente desmontar. Idempotente e
       * barata (só percorre as chaves que já existem no cache, não o mapa).
       */
      const { cols: colsNovo, rows: rowsNovo } = chunkCounts(map);
      for (const key of [...cache.current.keys()]) {
        const [cx, cz] = key.split(",").map(Number) as [number, number];
        if (cx < colsNovo && cz < rowsNovo) continue;
        cache.current.get(key)?.dispose();
        cache.current.delete(key);
        aguaCache.current.get(key)?.dispose();
        aguaCache.current.delete(key);
        precisaRefazer.current.delete(key);
      }
    }
    fonte.current = atual;

    const { cols, rows } = chunkCounts(map);
    const out: { key: string; geo: THREE.BufferGeometry; agua: THREE.BufferGeometry | null }[] = [];
    // quanto custou reconstruir nesta passada (o editor paga isso a cada edição)
    let construidos = 0;
    let custoMs = 0;
    /** chunks cuja geometria ANTIGA foi descartada nesta passada */
    let refeitos = 0;
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
    /**
     * Alcance do teste, medido até a CAIXA do chunk — não até o centro dele.
     *
     * Pelo centro era preciso somar meia diagonal (45 unidades) de folga, senão
     * o chunk em que o jogador está sumiria quando ele andasse para a beirada
     * dele. Só que essa folga vale para TODOS os chunks, inclusive os que estão
     * inteiros atrás da névoa: 45 unidades a mais de raio, em área, é muito.
     * Testando contra a caixa, ficam exatamente os chunks que ENCOSTAM no
     * círculo, e a folga deixa de existir.
     */
    const reach = cull ? radius! : 0;

    /**
     * Quem falta construir, do mais PERTO para o mais longe.
     *
     * Antes cada chunk que entrava no raio era construído no mesmo quadro, e é
     * daí que vinha o engasgo de andar: o centro de visão muda a cada 16
     * unidades (`useViewCenter`), a fileira nova traz uma dezena de chunks e
     * cada um custa ~2,5 ms — 25 ms num quadro que já gasta 16. Aqui o quadro
     * gasta no máximo `ORCAMENTO_MS` e o resto vai para a fila, que o
     * `useFrame` abaixo drena nos quadros seguintes.
     *
     * A ordem por distância é o que torna o atraso invisível: o buraco que
     * sobra fica sempre na BORDA do alcance, dentro da névoa.
     */
    const pendentes: { key: string; cx: number; cz: number; d2: number }[] = [];
    /**
     * Um anel ALÉM do alcance, construído por último.
     *
     * O chunk só entrava na fila quando já era necessário — ou seja, o custo
     * caía sempre no mesmo instante em que o jogador cruzava a fronteira. Com o
     * anel de folga pronto no cache, cruzar a fronteira não constrói nada: o
     * trabalho foi feito nos quadros ociosos de antes. Eles NÃO são desenhados
     * enquanto estão fora do alcance (não entram em `out`) — só ficam prontos.
     */
    const adiantar: { key: string; cx: number; cz: number; d2: number }[] = [];
    const t0Quadro = performance.now();
    const alcancePrefetch = reach + chunkSpan;

    for (let cz = rowStart; cz < rowEnd; cz++) {
      for (let cx = colStart; cx < colEnd; cx++) {
        let d2 = 0;
        if (cull) {
          // distância do centro de visão à CAIXA do chunk (0 se está dentro)
          const x0 = cx * chunkSpan, z0 = cz * chunkSpan;
          const dx = Math.max(x0 - center!.x, 0, center!.x - (x0 + chunkSpan));
          const dz = Math.max(z0 - center!.z, 0, center!.z - (z0 + chunkSpan));
          d2 = dx * dx + dz * dz;
          if (d2 > alcancePrefetch * alcancePrefetch) continue;
        }
        const key = `${cx},${cz}`;
        const geo = cache.current.get(key);
        const agua = aguaCache.current.get(key);
        const pronto = geo !== undefined && agua !== undefined;
        if (cull && d2 > reach * reach) {
          if (!pronto) adiantar.push({ key, cx, cz, d2 });
          continue;
        }
        if (pronto) {
          out.push({ key, geo: geo as THREE.BufferGeometry, agua: agua as THREE.BufferGeometry | null });
          // desatualizado: desenha o VELHO agora e entra na fila para trocar
          if (precisaRefazer.current.has(key)) pendentes.push({ key, cx, cz, d2 });
          continue;
        }
        pendentes.push({ key, cx, cz, d2 });
      }
    }

    pendentes.sort((a, b) => a.d2 - b.d2);
    adiantar.sort((a, b) => a.d2 - b.d2);
    const fila: typeof pendentes = [];
    for (const p of pendentes) {
      // o orçamento é do QUADRO: o que não coube espera o próximo
      if (performance.now() - t0Quadro > orcamentoMs) {
        fila.push(p);
        continue;
      }
      const t0 = performance.now();
      /**
       * TROCA, não preenchimento.
       *
       * `refazer` distingue "não existe" de "existe mas está velho". No segundo
       * caso a geometria nova é construída PRIMEIRO e só então a antiga é
       * descartada — é essa ordem que impede o buraco de um quadro que aparecia
       * como quadrado cinza. Com `?? build(...)` o chunk desatualizado nunca
       * seria refeito: o cache tem valor, então o `??` o devolveria para sempre.
       */
      const refazer = precisaRefazer.current.has(p.key);
      // "refeito" é criação E remoção no mesmo instante (a geometria velha é
      // descartada) — o laudo precisa dos dois números separados de "nasceu"
      if (refazer && cache.current.has(p.key)) refeitos++;
      const geo = !refazer && cache.current.has(p.key)
        ? cache.current.get(p.key)!
        : trocarGeometria(cache.current, p.key, buildChunkGeometry(map, p.cx, p.cz));
      let agua = aguaCache.current.get(p.key);
      if (refazer || agua === undefined) {
        agua = trocarGeometria(aguaCache.current, p.key, buildWaterGeometry(map, p.cx, p.cz));
      }
      precisaRefazer.current.delete(p.key);
      construidos++;
      const custoDeste = performance.now() - t0;
      custoMs += custoDeste;
      // início (`t0`), duração e quantas entidades moram ali — o suficiente para
      // pôr a montagem do chão na mesma linha do tempo que o pacote de movimento
      registrarEvento(
        "chunks",
        "construiu",
        { chunk: p.key, ms: custoDeste, entidades: entidadesNoChunk(p.cx, p.cz) },
        t0,
      );
      out.push({ key: p.key, geo, agua });
    }
    // o anel de folga vai no FIM: primeiro o que já está sendo olhado
    porConstruir.current = fila.concat(adiantar);
    registrarBuild(construidos, custoMs);
    somarChunk(construidos, custoMs);
    // "houve criação ou remoção de chunk no mesmo instante?" — a pergunta que o
    // retrato do `mundoVazio` faz. Coalescido lá dentro; o carimbo é sempre.
    marcarChunk(construidos, refeitos, cache.current.size);
    quadro().filaDeChunks = porConstruir.current.length;
    quadro().chunksVisiveis = out.length;
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
    /**
     * ENTRADA/SAÍDA DO CONJUNTO VISÍVEL — e ele NÃO é descarregamento.
     *
     * Culling muda draw calls e é o que o jogador sente ao andar, mas a
     * geometria continua no cache: nada é liberado aqui. Manter os dois eventos
     * com nomes diferentes é o que impede o laudo de concluir "o chunk foi
     * descarregado" olhando para uma lista que só encolheu.
     */
    if (import.meta.env.DEV) {
      const antes = visiveisAnterior.current;
      const agora = new Set(out.map((o) => o.key));
      let entraram = 0;
      let sairam = 0;
      for (const k of agora) if (!antes.has(k)) entraram++;
      for (const k of antes) if (!agora.has(k)) sairam++;
      if (entraram > 0 || sairam > 0) {
        registrarEvento("chunks", "visiveis", { entraram, sairam, total: agora.size });
      }
      visiveisAnterior.current = agora;
    }

    return out;
    // `versao` entra de propósito: quando o `useFrame` esvazia um pedaço da
    // fila, nenhuma das outras dependências mudou — sem ela o memo devolveria a
    // lista velha e o chunk recém-construído ficaria no cache sem ser desenhado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, map.collision, map.surface, map.heightmap, center?.x, center?.z, radius, versao, orcamentoMs]);

  /**
   * Drena a fila: mais um punhado de chunks por quadro, sempre com orçamento.
   *
   * Só chama `setState` quando construiu alguma coisa — e aí o memo acima roda
   * de novo e põe os novos no ar. Enquanto a fila está vazia isto custa uma
   * comparação por quadro.
   */
  useFrame(() => {
    const fila = porConstruir.current;
    const antecipada = filaPrecarga.current;
    if (fila.length === 0 && antecipada.length === 0) return;
    const t0 = performance.now();
    /**
     * Publica o avanço da pré-carga, se ele mudou.
     *
     * Chamado nas DUAS saídas do bloco de pré-carga (drenagem normal e desligar
     * por estouro de memória), porque quem espera na tela de carregamento
     * esperaria para sempre se o caso do estouro não avisasse.
     */
    const publicar = () => {
      const total = totalPrecarga.current;
      if (total === 0 || !onProgresso) return;
      const feitos = total - filaPrecarga.current.length;
      if (feitos === progressoPublicado.current) return;
      progressoPublicado.current = feitos;
      onProgresso(feitos, total);
    };
    let fez = 0;
    let ms = 0;

    /** constrói um chunk se ainda não estiver em cache; devolve o custo em ms */
    const construir = (p: { key: string; cx: number; cz: number }) => {
      const t1 = performance.now();
      // mesma regra do `useMemo`: desatualizado é RECONSTRUÍDO e trocado, não
      // preservado — o `has()` sozinho devolveria a geometria velha para sempre
      const refazer = precisaRefazer.current.has(p.key);
      if (refazer || !cache.current.has(p.key)) {
        trocarGeometria(cache.current, p.key, buildChunkGeometry(map, p.cx, p.cz));
      }
      if (refazer || !aguaCache.current.has(p.key)) {
        trocarGeometria(aguaCache.current, p.key, buildWaterGeometry(map, p.cx, p.cz));
      }
      precisaRefazer.current.delete(p.key);
      return performance.now() - t1;
    };

    // 1º o que está sendo OLHADO — a pré-carga nunca atrasa o que está à vista
    let fezAVista = 0;
    while (fila.length > 0 && performance.now() - t0 < orcamentoMs) {
      ms += construir(fila.shift()!);
      fez++;
      fezAVista++;
    }

    /**
     * 2º o resto do mapa, com o que sobrou do orçamento do quadro.
     *
     * O teto de memória é conferido com o tamanho REAL do primeiro chunk que
     * existir, projetado para o mapa inteiro. Acima dele a fila é descartada e
     * o streaming de sempre continua — é o caminho seguro para um mapa de
     * relevo pesado, onde a projeção passa de 170 MB.
     */
    if (antecipada.length > 0) {
      const amostra = cache.current.values().next().value as THREE.BufferGeometry | undefined;
      if (amostra) {
        const { cols, rows } = chunkCounts(map);
        /**
         * A projeção soma TERRENO + ÁGUA.
         *
         * Medindo só o terreno, um mapa com muito rio ou lago passava por baixo
         * do teto e a pré-carga seguia enchendo a memória — e memória de vídeo
         * apertada é o que faz o navegador começar a derrubar contexto WebGL
         * (`THREE.WebGLRenderer: Context Lost`). A lâmina é uma geometria
         * separada, num cache separado, e nunca esteve na conta.
         *
         * A amostra de água pode não existir (chunk sem água nenhuma), e aí ela
         * vale zero — o que é a verdade para aquele chunk.
         */
        const amostraAgua = aguaCache.current.values().next().value as THREE.BufferGeometry | null | undefined;
        const porChunk = bytesDaGeometria(amostra) + (amostraAgua ? bytesDaGeometria(amostraAgua) : 0);
        if (porChunk * cols * rows > PRECARGA_MAX_BYTES) {
          filaPrecarga.current = [];
          // quem espera tem de ser avisado de que não vem mais nada
          publicar();
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.info(
              `[SquareTerrain] pré-carga desligada: ${Math.round((porChunk * cols * rows) / 1048576)} MB projetados`,
            );
          }
        }
      }
      const restante = filaPrecarga.current;
      while (restante.length > 0 && performance.now() - t0 < orcamentoMs) {
        const p = restante.shift()!;
        // já construído por estar à vista: sai da fila sem custar nada
        if (cache.current.has(p.key)) continue;
        ms += construir(p);
        fez++;
      }
      publicar();
    }

    if (fez > 0) {
      registrarBuild(fez, ms);
      somarChunk(fez, ms);
      marcarChunk(fez, 0, cache.current.size);
    }
    /**
     * Só reabre o `useMemo` quando o que ficou pronto está À VISTA.
     *
     * A pré-carga constrói o que está FORA do alcance — nada do que ela produz
     * entra em `visible`, e um `setState` por quadro durante os ~450 ms dela
     * reconciliaria a cena inteira dezenas de vezes sem mudar um pixel.
     */
    if (fezAVista > 0) setVersao((v) => v + 1);
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __terrainStats?: unknown }).__terrainStats = {
      chunks: visible.length,
      chunksEmCache: cache.current.size,
      celulasPorChunk: CHUNK_CELLS * CHUNK_CELLS,
      mapa: `${map.size.width}x${map.size.height}`,
    };
  }

  /**
   * Os nomes são RÓTULO para o flight recorder, e é o que separa "chunks" de
   * "terreno" na contagem por categoria (`core/diagnostics/cenaProbe`). O
   * `<group name={TERRAIN_GROUP}>` do `PlayView` envolve isto tudo, então sem
   * eles chão e lâmina viriam somados num número só e o retrato de um mundo
   * vazio não diria qual dos dois sumiu. Grupos inertes: nenhuma transform.
   */
  return (
    <group name="chunks">
      {visible.map(({ key, geo, agua }) => (
        <group key={key}>
          <mesh geometry={geo} material={material} receiveShadow />
          {agua && (
            <group name="agua">
              <mesh geometry={agua} material={materialAgua} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * Lâmina d'água: translúcida, quase sem brilho difuso e sem sombra.
 *
 * O leito fica afundado (`visualLevel`), então a transparência deixa o fundo
 * aparecer e a água ganha profundidade — e a lâmina lê três coisas do leito,
 * pelos atributos que `buildWaterGeometry` mede nos cantos:
 *
 *  • **profundidade** — raso puxa para o turquesa e fica mais transparente;
 *    fundo puxa para o azul escuro e esconde o leito. É o que separa, à vista,
 *    a margem que se atravessa do canal que bloqueia;
 *  • **margem** — faixa clara de espuma onde a água encosta na terra, como na
 *    `ref2`. Sem ela a água termina num corte reto contra a grama;
 *  • **ondulação** — o mesmo fbm do chão, deslizando devagar. É a única coisa
 *    animada aqui; sem movimento nenhum a lâmina parece vidro.
 */
/**
 * A aquarela da água, UMA por variante — cache de módulo.
 *
 * Ela não depende do mapa: são quatro PNGs no acervo inteiro
 * (`agua/Water_0*.png`). Criada dentro do `makeWaterMaterial`, nascia uma
 * `Texture` NOVA a cada troca de mapa e nunca era descartada — a limpeza do
 * `SquareTerrain` só descartava geometrias. Vazamento pequeno em valor absoluto
 * (uma textura por portal) mas sem teto numa sessão longa.
 *
 * Compartilhada, ela também nunca precisa ser descartada: quatro texturas de
 * acervo fixo são estado do módulo, como as canônicas do `gltfTexturas`.
 */
const aquarelas = new Map<string, THREE.Texture>();

function aquarelaDe(variante: string): THREE.Texture {
  const pronta = aquarelas.get(variante);
  if (pronta) return pronta;
  const tex = new THREE.TextureLoader().load(`/assets/terrain/${variante}.png`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // NÃO é cor, é RAZÃO — ver o bloco em `makeWaterMaterial`
  tex.colorSpace = THREE.NoColorSpace;
  aquarelas.set(variante, tex);
  return tex;
}

function makeWaterMaterial(estilo?: GameMap["terrainStyle"]): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2f6ea8"),
    transparent: true,
    opacity: 0.78,
    roughness: 0.25,
    metalness: 0.1,
    // sem `depthWrite` a água não apaga o que está atrás dela na mesma célula
    depthWrite: false,
  });

  /**
   * A aquarela entra como PADRÃO NEUTRO, não como cor.
   *
   * O PNG é gerado com a média em cinza (ver `make-terrain-textures.mjs`), então
   * `texel / 0.5` é a razão de cada pixel em relação à média: a mancha e a
   * variação de matiz da pintura sobrevivem, a cor absoluta não. É o que
   * preserva a leitura de PROFUNDIDADE — turquesa no raso, azul escuro no
   * fundo —, que é o que faz o canal bloqueado parecer intransponível antes de
   * o jogador tentar atravessá-lo.
   */
  const aquarela = aquarelaDe(varianteDeAgua(estilo));
  /**
   * `NoColorSpace`, NÃO sRGB — e é o que faz a pintura aparecer.
   *
   * Esta textura não é COR, é RAZÃO: o gerador escreve a média em 128 para que
   * `texel / 0.5` seja "quanto este pixel difere da média". Marcada como sRGB, o
   * three decodifica na amostragem e o 128 chega ao shader como **0,216** — a
   * divisão por 0,5 então escurecia a água inteira em ~43% e comprimia a
   * variação a quase nada. Era o "a textura da água não renderiza".
   *
   * O chão não tem esse problema porque lá a divisão é por uma `THREE.Color`,
   * que também está em espaço linear — os dois lados na mesma escala.
   *
   * As configurações vivem no `aquarelaDe`, junto da criação: a textura agora é
   * compartilhada, e mutá-la aqui reconfiguraria a de todos os mapas abertos.
   */

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTempo = { value: 0 };
    shader.uniforms.uAguaRaso = { value: new THREE.Color("#57b6c8") };
    shader.uniforms.uAguaFundo = { value: new THREE.Color("#1d4f80") };
    shader.uniforms.uAquarela = { value: aquarela };
    shader.uniforms.uAguaTile = { value: 1 / Math.max(0.5, escalaDe("water", estilo)) };
    // guarda o shader para o `useFrame` avançar o tempo (o material é um só,
    // compartilhado por todos os chunks de água)
    (mat as MaterialComTempo).uTempo = shader.uniforms.uTempo;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aProfundidade;
attribute float aMargem;
varying float vProf;
varying float vMargem;
varying vec3 vAguaMundo;
uniform float uTempo;
// AMPLITUDE/VELOCIDADE da onda de vértice — mesmos números usados pra
// deslocar Y e pra inclinar a normal (ver os dois blocos abaixo). Histórico:
// 0,12 sem normal (imperceptível) → 0,30 com normal (fraco em gameplay
// normal) → 0,55 (relatado como EXAGERADO — "balançando"/deformando forte
// demais) → 0,16 (este valor): a NORMAL (não o deslocamento em si) é quem
// carrega a percepção de movimento — com ela ligada, uma amplitude pequena
// já muda a luz a cada quadro; não precisa de onda grande pra não parecer
// parada.
#define AMP_ONDA 0.16
#define FREQ_X 0.35
#define FREQ_Z 0.28
#define VEL_A 0.75
#define VEL_B 0.55`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
{
  // NORMAL da onda — sem isto o deslocamento de Y abaixo é invisível de
  // longe: a malha se move mas a luz reflete igual, porque a normal
  // continua reta pra cima. A INCLINAÇÃO (derivada analítica da mesma
  // função de onda) é o que faz o brilho variar quadro a quadro — é essa
  // variação de luz, não o deslocamento em si, que o olho realmente pega.
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float fase = wp.z * FREQ_Z - uTempo * VEL_B + wp.x * 0.12;
  float dydx = (cos(wp.x * FREQ_X + uTempo * VEL_A) * FREQ_X * 0.6 - sin(fase) * 0.12 * 0.4) * AMP_ONDA;
  float dydz = (-sin(fase) * FREQ_Z * 0.4) * AMP_ONDA;
  objectNormal = normalize(objectNormal + vec3(-dydx, 0.0, -dydz));
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vProf = aProfundidade;
vMargem = aMargem;
{
  // ONDA DE VÉRTICE — antes disto a "animação" da água era só a cor
  // (mistura de fbm no fragment, ±10% de brilho): balançava a PINTURA, não
  // a MALHA, e de longe/em movimento normal isso lê como água parada. Este
  // bloco desloca o vértice em Y de verdade — GEOMÉTRICO, não cor —, e a
  // normal (bloco acima) faz a luz responder junto.
  vec3 aguaMundoPre = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float onda1 = sin(aguaMundoPre.x * FREQ_X + uTempo * VEL_A);
  float onda2 = cos(aguaMundoPre.z * FREQ_Z - uTempo * VEL_B + aguaMundoPre.x * 0.12);
  transformed.y += (onda1 * 0.6 + onda2 * 0.4) * AMP_ONDA;
}
vAguaMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vProf;
varying float vMargem;
varying vec3 vAguaMundo;
uniform float uTempo;
uniform vec3 uAguaRaso;
uniform vec3 uAguaFundo;
uniform sampler2D uAquarela;
uniform float uAguaTile;
${GROUND_NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // 0,7 é a profundidade do canal fundo de rio (leito em -0,8 sob a lâmina em
  // -0,1); lago fica em ~0,36 e a margem rasa em ~0,21
  float prof = clamp(vProf / 0.7, 0.0, 1.0);
  diffuseColor.rgb = mix(uAguaRaso, uAguaFundo, prof);

  // duas escalas de onda em sentidos diferentes, senão a superfície inteira
  // desliza para um lado só e parece uma textura sendo arrastada
  float onda = groundFbm(vAguaMundo.xz * 0.22 + vec2(uTempo * 0.035, uTempo * 0.02))
             * 0.65
             + groundFbm(vAguaMundo.xz * 0.7 - vec2(uTempo * 0.017, uTempo * 0.041)) * 0.35;
  diffuseColor.rgb *= 0.88 + onda * 0.22;

  // aquarela como PADRÃO: o PNG tem média cinza, então texel/0.5 é a razão de
  // cada pixel em relação à média. Duas amostras deslizando em sentidos
  // diferentes, senão a pintura fica parada por baixo da onda e denuncia o
  // ladrilho.
  vec2 uvA = vAguaMundo.xz * uAguaTile + vec2(uTempo * 0.004, uTempo * 0.003);
  vec2 uvB = vAguaMundo.xz * uAguaTile * 0.61 - vec2(uTempo * 0.0025, uTempo * 0.0045);
  // MULTIPLICA as duas amostras em vez de tirar média: a média de duas amostras
  // descorrelacionadas CANCELA a variação (era metade do motivo de a pintura
  // não aparecer), enquanto o produto a mantém. A segunda entra com menos peso
  // — ela existe só para quebrar a repetição do ladrilho, não para dobrar o
  // contraste.
  vec3 pA = texture2D(uAquarela, uvA).rgb / 0.5;
  vec3 pB = texture2D(uAquarela, uvB).rgb / 0.5;
  diffuseColor.rgb *= pA * mix(vec3(1.0), pB, 0.45);

  float espuma = smoothstep(0.95, 0.58, vMargem);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.95, 0.98), espuma * 0.55);

  // raso quase transparente (o leito aparece), fundo opaco — é o que faz o
  // canal bloqueado LER como intransponível antes de o jogador tentar
  diffuseColor.a *= mix(0.55, 1.0, prof) + espuma * 0.2;

  /**
   * A margem é a ISOLINHA 0,5 do campo de canto — não a borda do quad.
   *
   * A lâmina é um quad por célula, então o contorno dela é uma ESCADA de 90°,
   * que é o que a referência square-form.jpg aponta com as setas. vMargem é a
   * fração das células daquele canto que são água (1 no miolo, 0,5 na beira,
   * 0,25 numa quina) e o rasterizador a interpola: cortar em 0,5 faz a água
   * terminar numa DIAGONAL dentro da célula de fronteira, que é o mesmo
   * contorno que um marching squares daria — sem geometria nova.
   *
   * Antes havia um piso de 0,40 aqui: ele mantinha o quad inteiro visível até a
   * quina e era justamente ele que deixava o degrau à mostra.
   *
   * O limiar fica ACIMA de 0,5 porque a geometria existe só sobre as células de
   * água: com o corte em 0,5 o contorno cairia exatamente na borda do quad, e
   * seria a borda do quad — a escada — que se veria. Puxando para ~0,6 a
   * isolinha entra meia célula para dentro, onde há malha de sobra para
   * desenhá-la.
   */
  diffuseColor.a *= smoothstep(0.45, 0.70, vMargem);
}`,
      );
  };
  mat.customProgramCacheKey = () => "square-water";
  return mat;
}

/** o material da água guarda o uniform de tempo para o `useFrame` avançar */
type MaterialComTempo = THREE.Material & { uTempo?: { value: number } };


/**
 * Material do chão quadrado: textura pintada por tipo de terreno + tinta por
 * vértice + o ruído de macro-escala.
 *
 * Três camadas, nesta ordem:
 *
 * 1. **Textura** (`grid/terrainTextures`), amostrada em coordenada de MUNDO —
 *    não há `uv` na malha, e não faria sentido ter: um quad por célula daria
 *    uma UV de 2×2 unidades e a textura repetiria em cada célula, desenhando a
 *    grade. Como o padrão é seamless e a coordenada é contínua entre chunks,
 *    não há costura em lugar nenhum.
 * 2. **Tinta do vértice**: a textura entra como PADRÃO (`texel / corBase`), não
 *    como cor final. Assim a mata continua verde-escura e o penhasco marrom
 *    usando a mesma textura de grama/terra, e a paleta do projeto segue sendo a
 *    fonte da cor — inclusive o realce que o editor pinta.
 * 3. **Ruído de macro-escala**: quebra a repetição num mapa de 400×400 células,
 *    onde a mesma textura aparece ~100 vezes na tela.
 *
 * A projeção é TRIPLANAR simplificada: topo pelo plano XZ, saia vertical pelo
 * plano da parede. Sem isso a saia (que é o que aparece na montanha e no
 * barranco) recebe a textura esticada num borrão vertical. Custa 2 amostras
 * porque a MISTURA é de UV, não de texel: topo e saia são quads separados, com
 * normais próprias e sem vértice em comum, então o peso é praticamente
 * constante dentro de cada quad e não há banda de esticamento entre eles.
 *
 * `sampler2DArray` exige GLSL ES 3.00 — e é o que o three já usa para TODO
 * material embutido (`WebGLProgram.js`: a conversão para `#version 300 es` é
 * incondicional fora do `RawShaderMaterial`). Por isso NÃO se mexe em
 * `material.glslVersion`: setá-lo para `GLSL3` faria o three parar de declarar
 * `pc_fragColor`/`gl_FragColor`, que os chunks embutidos escrevem, e o shader
 * nem compilaria.
 */
function makeSquareGroundMaterial(ground?: GameplayConfig, estilo?: GameMap["terrainStyle"]): THREE.Material {
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
  // `groundMode` já existe no ServerConfig e o chão quadrado o ignorava; agora é
  // o interruptor da textura ("color" = a paleta chapada de antes).
  const texturado = (ground?.groundMode ?? "texture") !== "color";
  // uma escala POR CAMADA: cada superfície pede um tamanho de padrão diferente,
  // e o mapa pode sobrescrever qualquer uma (`terrainStyle[...].scale`)
  const tiles = escalasPorCamada(estilo).map((u) => 1 / Math.max(0.5, u));

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundFreq = { value: freq };
    shader.uniforms.uGroundNoise = { value: amount };
    shader.uniforms.uTerrain = { value: terrainArrayTexture() };
    shader.uniforms.uTerrainBase = { value: terrainBaseColors() };
    shader.uniforms.uTexTile = { value: tiles };
    shader.uniforms.uTexOn = { value: texturado ? 1 : 0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aLayerA;
attribute float aLayerB;
attribute float aBlend;
varying vec3 vGroundWorld;
varying vec3 vGroundNormalW;
varying vec3 vGroundLayers;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
vGroundNormalW = normalize(mat3(modelMatrix) * objectNormal);
vGroundLayers = vec3(aLayerA, aLayerB, aBlend);`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGroundWorld;
varying vec3 vGroundNormalW;
varying vec3 vGroundLayers;
uniform sampler2DArray uTerrain;
uniform vec3 uTerrainBase[${TERRAIN_LAYERS.length}];
uniform float uGroundFreq;
uniform float uGroundNoise;
uniform float uTexTile[${TERRAIN_LAYERS.length}];
uniform float uTexOn;
${GROUND_NOISE_GLSL}

// padrão de uma camada: o texel dividido pela cor em que a textura foi pintada.
// 1.0 = pixel na cor base; >1 clareia, <1 escurece — e a cor final continua
// vindo da tinta do vértice. A ESCALA é por camada: a UV chega em unidades de
// mundo e é dividida aqui, senão duas superfícies com tamanhos de padrão
// diferentes teriam de compartilhar um número só.
vec3 padraoTerreno(vec2 uvMundo, float camada) {
  int i = int(camada + 0.5);
  return texture(uTerrain, vec3(uvMundo * uTexTile[i], camada)).rgb / max(uTerrainBase[i], vec3(0.004));
}

// Mistura as DUAS projeções (topo e lado) pelas AMOSTRAS, não pelas
// coordenadas. Misturar UV parecia mais barato — e é —, mas numa encosta a
// normal muda de canto a canto do mesmo quad, então o peso varia dentro do
// triângulo e as duas coordenadas se disputam: o resultado é a textura
// escorrendo em riscos verticais na ladeira. Com duas amostras a transição é
// uma dissolução limpa.
vec3 terrenoTriplanar(vec2 uvTopo, vec2 uvLado, float camada, float wTopo) {
  if (wTopo >= 0.995) return padraoTerreno(uvTopo, camada);
  if (wTopo <= 0.005) return padraoTerreno(uvLado, camada);
  return mix(padraoTerreno(uvLado, camada), padraoTerreno(uvTopo, camada), wTopo);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  if (uTexOn > 0.5) {
    // topo pelo plano XZ; saia vertical pelo plano da própria parede
    vec3 nW = normalize(vGroundNormalW);
    float cima = clamp(abs(nW.y), 0.0, 1.0);
    float wTopo = smoothstep(0.25, 0.80, cima);
    // em unidades de MUNDO: quem divide pela escala é o padraoTerreno, que sabe
    // de qual camada se trata
    vec2 uvTopo = vGroundWorld.xz;
    vec2 uvLado = abs(nW.x) > abs(nW.z) ? vGroundWorld.zy : vGroundWorld.xy;

    // A camada B só é amostrada onde ela PESA. No miolo de uma região uniforme
    // o peso é 0 e as duas amostras dela (triplanar) eram jogadas fora pela
    // mistura — e "no miolo" é a maior parte da tela. A camada é constante no
    // quad, então o branch é coerente e não divide o warp.
    float pesoB = clamp(vGroundLayers.z, 0.0, 1.0);
    vec3 padrao = terrenoTriplanar(uvTopo, uvLado, vGroundLayers.x, wTopo);
    if (pesoB > 0.004) {
      padrao = mix(padrao, terrenoTriplanar(uvTopo, uvLado, vGroundLayers.y, wTopo), pesoB);
    }
    diffuseColor.rgb *= padrao;
  }
  if (uGroundNoise > 0.0) {
    vec2 gp = vGroundWorld.xz * uGroundFreq;
    // manchas LARGAS só: o granulado fino agora vem da textura, e somar os dois
    // devolvia o aspecto de ruído por cima do desenho
    float n = groundFbm(gp * 0.35);
    diffuseColor.rgb *= 1.0 + (n - 0.5) * uGroundNoise * 0.8;
  }
}`,
      );
  };
  // a escala entra por uniform, então não muda o PROGRAMA — só o cache key do
  // que de fato reescreve o shader
  mat.customProgramCacheKey = () =>
    `square-ground:${freq.toFixed(3)}:${amount.toFixed(3)}:${texturado ? 1 : 0}`;
  return mat;
}
