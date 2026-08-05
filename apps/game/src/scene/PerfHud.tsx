import { useEffect, useRef, useState } from "react";
import { MINIMAP_WIDTH } from "../ui/minimap";
import { useFrame, useThree } from "@react-three/fiber";
import { perfSnapshot, registrarQuadro, registrarRenderer } from "./perfProbe";
import {
  abrirQuadro,
  ativo,
  avaliarGatilho,
  baixarJson,
  casosCapturados,
  desligar,
  dispararCaptura,
  estado,
  ligar,
  quadro,
  registrarColetorDeMeta,
  removerColetorDeMeta,
  timeline,
} from "../core/diagnostics/flightRecorder";
import {
  amostrarContadores,
  instantaneoDoRenderer,
  observarRenderer,
  observarMatrizesDaCena,
  registrarMetaDeGpu,
} from "../core/diagnostics/rendererProbe";
import { amostrarCena, avaliarMundoVazio, instantaneoDaCena } from "../core/diagnostics/cenaProbe";
import { censoComRenderer } from "../core/diagnostics/censo";

/**
 * Medidor de quadro — DEV apenas, ligado com **F9** (a escolha fica no
 * navegador).
 *
 * São duas peças porque elas vivem em mundos diferentes: `PerfProbe` roda
 * DENTRO do `<Canvas>` (é lá que existe `gl` e o laço de quadro) e `PerfOverlay`
 * é DOM comum, por fora. A ponte entre as duas é o módulo `perfProbe`, não o
 * React: o overlay lê num `requestAnimationFrame` próprio e escreve por `ref`.
 *
 * `registrarQuadro` fica num `useFrame` de prioridade ALTA (-1000) para ser a
 * primeira coisa do quadro; o `gl.info` é lido no snapshot, já com os números do
 * quadro anterior fechados.
 */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    registrarRenderer(gl);
    // `__gl()` no console: `gl.info.render` é a única fonte de draw call de
    // verdade, e antes disso só `scene`/`camera` eram alcançáveis.
    (window as unknown as { __gl?: () => unknown }).__gl = () => gl;
    (window as unknown as { __perf?: () => unknown }).__perf = () => perfSnapshot();
    // `principal`: é ESTE canvas que arma o gatilho de renderer recriado e que
    // tem `gl.render` embrulhado. Os retratos do HUD entram pela `SondaDeCanvas`
    // e só contam em `contextosVivos` — ver `core/diagnostics/rendererProbe`.
    const soltar = observarRenderer(gl, { nome: "jogo", principal: true });
    registrarMetaDeGpu(gl);
    /**
     * `__censo()` — a auditoria de assets, sob demanda.
     *
     * Precisa da `scene` E do `gl`: o censo conta o GRAFO e o `gl.info` conta o
     * RENDERER, e é a diferença entre os dois que denuncia recurso vivo fora da
     * cena. Um getter, não um objeto: o grafo muda o tempo todo e uma cópia
     * mentiria a composição de segundos atrás.
     */
    const censo = () => censoComRenderer(scene as never, gl.info as never);
    (window as unknown as { __censo?: () => unknown }).__censo = censo;
    // COLETOR, não valor: registrado como valor aqui, o censo descreveria a cena
    // no instante da montagem — que é uma cena vazia
    registrarColetorDeMeta("censo", censo);
    // `scene.updateMatrixWorld` — a coluna `matrizMs`, que é o número da
    // decisão sobre instancing de props (ver o plano de auditoria)
    const soltarMatriz = observarMatrizesDaCena(scene);
    return () => {
      removerColetorDeMeta("censo");
      soltarMatriz();
      soltar();
      registrarRenderer(null);
    };
  }, [gl, scene]);

  /**
   * Prioridade −1000: primeiro do quadro.
   *
   * O flight recorder recebe as colunas de desenho AQUI e a linha é fechada
   * depois, no `useFrame` do `NetPlayer` — que roda em prioridade normal, ou
   * seja, mais tarde. É o que garante que o tempo do quadro e o movimento
   * daquele mesmo quadro caiam na mesma linha.
   *
   * `gl.info.render` traz os números do quadro ANTERIOR (o atual ainda não
   * desenhou), e é o mais próximo da verdade que dá para ler daqui — o mesmo
   * que o overlay já mostra.
   */
  useFrame((_, dt) => {
    const ms = dt * 1000;
    registrarQuadro(ms);
    if (!import.meta.env.DEV) return;
    /**
     * Fecha a linha ANTERIOR quando ninguém a fechou.
     *
     * Quem fecha normalmente é o `NetPlayer`, e ele só monta com sessão. Sem
     * isto o gravador não gravava nada no preview do editor, num mapa sem cena
     * 3D ou na tela de erro — telas em que uma investigação de RENDERIZAÇÃO é
     * perfeitamente possível. Com o dono presente, esta chamada não faz nada.
     */
    abrirQuadro();
    // o `NetPlayer` sobrescreve `t` logo adiante no mesmo quadro (ele o escreve
    // cedo para o gatilho de rollback ancorar); sem sessão, é este que vale
    quadro().t = performance.now();
    /**
     * O quadro ANTERIOR desenhou quanto?
     *
     * `gl.info.render` é resetado dentro de `gl.render`, então lido aqui — no
     * começo do quadro, antes de qualquer desenho — ele traz o total fechado do
     * quadro passado. É essa a série que o `mundoVazio` observa.
     */
    const calls = gl.info.render.calls;
    if (ativo()) {
      const q = quadro();
      q.quadroMs = ms;
      q.drawCalls = calls;
      q.triangulos = gl.info.render.triangles;
    }
    // contadores do device + a série de render/GPU/memória
    amostrarContadores(gl);
    // a árvore da cena: filhos, visibilidade, câmera, chunks, props, suspensão
    amostrarCena(scene, camera, calls);
    // ninguém chamava este gatilho — ele estava declarado e nunca disparou
    avaliarGatilho("frameLongo", ms);
    /**
     * Por ÚLTIMO: o retrato do `mundoVazio` lê as colunas que acabaram de ser
     * escritas acima. Avaliado antes, ele descreveria o quadro anterior.
     */
    avaliarMundoVazio(gl, scene, camera, calls);
  }, -1000);
  return null;
}

export function PerfOverlay() {
  const [aberto, setAberto] = useState(() => localStorage.getItem("ragnarok.perf") === "1");
  const caixa = useRef<HTMLDivElement>(null);
  const voo = useRef<HTMLDivElement>(null);
  /** só para o botão trocar de rótulo; o estado de verdade mora no recorder */
  const [gravando, setGravando] = useState(() => ativo());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F9") return;
      e.preventDefault();
      setAberto((v) => {
        localStorage.setItem("ragnarok.perf", v ? "0" : "1");
        return !v;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    /**
     * A seção do flight recorder anda a ~4 Hz, não a 60.
     *
     * Ela mostra contadores que mudam devagar (quadros no anel, casos
     * capturados), e repintá-los todo quadro seria gastar quadro para medir
     * quadro — o mesmo motivo pelo qual o resto do overlay escreve por `ref` em
     * vez de `setState`.
     */
    let proximoVoo = 0;
    const tick = () => {
      if (!vivo) return;
      const agora = performance.now();
      if (voo.current && agora >= proximoVoo) {
        proximoVoo = agora + 250;
        const v = estado();
        const casos = casosCapturados();
        voo.current.innerHTML = [
          // "parado" em VERMELHO: na referência do laudo o voo estava desligado
          // e por isso não havia caso nenhum para ler. Medir achando que se
          // está gravando é o pior modo de perder um defeito raro.
          linha("voo", v.gravando ? (v.capturando ? "CAPTURANDO" : "gravando") : "PARADO", !v.gravando),
          linha("anel", `${v.quadros} quadros · ${v.eventos} ev`),
          linha("caminhada", `#${v.walkId}`),
          linha("casos", `${casos.length}${casos.length ? ` (${casos[casos.length - 1]!.motivo})` : ""}`, casos.length > 0),
        ].join("");
      }
      const el = caixa.current;
      if (el) {
        const p = perfSnapshot();
        const r = instantaneoDoRenderer();
        const c = instantaneoDaCena();
        // innerHTML direto: é DEV, são ~12 linhas, e passar isso por estado do
        // React seria repintar a árvore 60×/s para medir repintura
        el.innerHTML = [
          linha("fps", `${p.fps}`, p.fps < 50),
          linha("quadro p50", `${p.p50.toFixed(1)} ms`, p.p50 > 18),
          linha("quadro p99", `${p.p99.toFixed(1)} ms`, p.p99 > 22),
          linha("pior (5 s)", `${p.pior.toFixed(1)} ms`, p.pior > 33),
          // cpu = tempo dentro de `gl.render`; gpu = timer query, "—" onde a
          // extensão não existe. A 60 FPS com vsync o cpu esconde o custo de
          // GPU, e é por isso que os dois aparecem.
          linha("render cpu/gpu", `${r.renderMs.toFixed(1)} / ${num(r.gpuMs, 1)} ms`, r.renderMs > 12),
          /**
           * O jogo + um retrato é o normal. 4 ou mais é CHURN de canvas, que foi
           * exatamente o defeito: o Chrome mantém ~16 contextos e, ao estourar,
           * força a perda do mais antigo — o do jogo.
           */
          linha("contextos", `${r.contextos} (renderer #${r.rendererId})`, r.contextos > 3),
          linha("vram/heap", `${num(r.memoriaGpuMb, 0)} / ${num(r.heapMb, 0)} MB`),
          /**
           * A ÁRVORE, e é a linha que responde o apagão: 0 draw calls com
           * `filhos` cheio e `vis?` NÃO é Suspense ou `OcultarCena`; com
           * `filhos` zerado é desmonte de verdade.
           */
          linha(
            "cena",
            `${c.filhos} filhos · ${c.visiveis} vis${c.visivel ? "" : " · OCULTA"}${c.suspenso ? " · SUSPENSA" : ""}`,
            !c.visivel || c.suspenso,
          ),
          linha("assets em voo", `${c.emVoo}`, c.emVoo > 0),
          /**
           * A DECOMPOSIÇÃO do custo, acumulada desde o boot: contexto WebGL,
           * descarte de renderer e clone de modelo. Um `frameLongo` que não
           * mexe em nenhum dos três não é de nenhum deles — é React ou coletor.
           * `ctx` conta também quantos contextos nasceram: em regime esse
           * número tem de PARAR de subir.
           */
          linha(
            "ctx/descarte/modelo",
            `${r.contextoMsTotal.toFixed(0)}/${r.descarteMsTotal.toFixed(0)}/${r.modeloMsTotal.toFixed(0)} ms (${r.contextosCriados} ctx)`,
            r.contextosCriados > 4,
          ),
          linha("draw calls", `${p.calls}`, p.calls === 0),
          linha("triângulos", `${(p.triangulos / 1000).toFixed(0)} k`),
          linha("chunks/s", `${p.chunksPorSegundo} (${p.msDeChunkPorSegundo} ms)`, p.msDeChunkPorSegundo > 8),
          linha("chunks total", `${p.chunksTotal} (${p.msDeChunkTotal} ms)`),
          linha("geo/tex/prog", `${p.geometrias}/${p.texturas}/${p.programas}`),
          // vazamento de textura não dá para pegar em teste (não há WebGL no
          // vitest): em regime este número é 0, e vermelho aqui é bug de
          // descarte, não "cena grande"
          linha("tex novas (10 s)", `${p.texturasVazando > 0 ? "+" : ""}${p.texturasVazando}`, p.texturasVazando > 3),
        ].join("");
      }
      requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [aberto]);

  if (!aberto) return null;
  return (
    <div
      style={{
        position: "absolute",
        /**
         * À ESQUERDA DO MINIMAPA, e não no canto superior-esquerdo.
         *
         * Lá ele cobria a placa do personagem — justamente as barras que se quer
         * olhar enquanto se mede. Aqui ele encosta no minimapa (`top`/`right` os
         * mesmos do bloco dele em `hud/Hud`) e o vão do meio da tela fica livre.
         *
         * `MINIMAP_WIDTH` importado, não copiado: mexer na largura do minimapa
         * tem de mover o painel junto, senão os dois se sobrepõem calados.
         */
        top: 10,
        right: MINIMAP_WIDTH + 20,
        zIndex: 50,
        // a caixa toda continua transparente ao mouse: 190 px no canto não podem
        // engolir clique de andar. Só os BOTÕES voltam a `auto`, abaixo.
        pointerEvents: "none",
        background: "rgba(8,10,15,0.82)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 6,
        padding: "6px 8px",
        minWidth: 190,
        font: "11px ui-monospace, monospace",
        color: "#cfd6e4",
        lineHeight: 1.5,
      }}
    >
      <div ref={caixa} />
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.14)", margin: "5px 0" }} />
      <div ref={voo} />
      <div style={{ display: "flex", gap: 4, marginTop: 5, pointerEvents: "auto" }}>
        <Botao
          rotulo={gravando ? "parar" : "gravar"}
          onClick={() => {
            if (ativo()) desligar();
            else ligar();
            setGravando(ativo());
          }}
        />
        <Botao rotulo="capturar" onClick={() => dispararCaptura("manual")} />
        <Botao rotulo="JSON" onClick={() => baixarJson()} />
        <Botao
          rotulo="timeline"
          onClick={() => {
            const c = casosCapturados();
            // o console é o lugar certo: a linha do tempo é texto de laudo, e
            // ela não caberia — nem se leria — dentro de uma caixa de 190 px
            // eslint-disable-next-line no-console
            console.log(c.length ? timeline(c[c.length - 1]!) : "sem caso capturado");
          }}
        />
      </div>
    </div>
  );
}

function Botao({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        cursor: "pointer",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 4,
        color: "#e6e8ee",
        font: "10px ui-monospace, monospace",
        padding: "3px 2px",
      }}
    >
      {rotulo}
    </button>
  );
}

/** "—" para o que não foi medido: zero ali seria um número inventado */
function num(v: number, casas: number): string {
  return Number.isFinite(v) ? v.toFixed(casas) : "—";
}

function linha(nome: string, valor: string, alerta = false): string {
  const cor = alerta ? "#f87171" : "#e6e8ee";
  return `<div style="display:flex;justify-content:space-between;gap:12px"><span style="opacity:.65">${nome}</span><b style="color:${cor}">${valor}</b></div>`;
}
