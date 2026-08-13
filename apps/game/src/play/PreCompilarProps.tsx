import { Suspense, useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import * as THREE from "three";
import { PropInstance } from "../props/PropInstance";
import { registrarEvento } from "../core/diagnostics/flightRecorder";

/**
 * Paga a COMPILAÇÃO DE SHADER dos props atrás da cortina.
 *
 * ## O defeito que ela corrige
 *
 * Medido no `voo-1785940564494.json`: um quadro de **207,6 ms** com
 * `renderMs` **190,4** e `gpuMs` **193,9** — 92% dele dentro de `gl.render` —,
 * `longtask` de 197 ms marcada como UMA tarefa, e a coluna `programas` subindo
 * de **19 para 20** naquele quadro exato. Props novos tinham acabado de entrar
 * no culling (473 → 479) trazendo uma variante de material que nunca fora
 * desenhada, e o primeiro `draw` dela pagou o link do programa.
 *
 * `contextoMs`, `descarteMs` e `modeloMs` deram ZERO no mesmo quadro, então não
 * era criar contexto (isso custa 8 ms, medido), nem descartar renderer, nem
 * clonar modelo. Era compilar.
 *
 * ## Por que aqui e não no aquecimento que já existe
 *
 * A fase de aquecimento (`play/aquecimento`) já espera `gl.info.programs.length`
 * estabilizar com a cena desenhando atrás da cortina — mas ela só aquece o que
 * está DENTRO do culling naquele instante. A espécie de prop que aparece
 * quinhentas células adiante não está lá, e é justamente ela que estoura o
 * quadro quando o jogador chega perto.
 *
 * ## Por que fora do frustum, e por que `compileAsync`
 *
 * Uma instância de cada espécie é montada em `Y_DEPOSITO`, longe do olho: elas
 * não podem aparecer na tela nem por um quadro. Só que, fora do frustum, o
 * three não as DESENHA — e sem desenhar não compila. Quem resolve isso é
 * `WebGLRenderer.compileAsync(scene, camera)`, que percorre a cena por
 * `traverseVisible` (frustum não entra na conta) e compila tudo, usando
 * `KHR_parallel_shader_compile` quando existe, sem bloquear.
 *
 * Corolário que importa: os objetos precisam estar `visible` — é `traverseVisible`,
 * não `traverse`. Escondê-los seria o jeito óbvio e teria desligado a correção
 * inteira em silêncio.
 *
 * ## Por que virou INCREMENTAL (correção, `voo-1786573041420.json`)
 *
 * A versão original chamava `gl.compileAsync(scene, camera)` **uma vez**, com
 * a `scene` INTEIRA — que já teria terreno, céu e todo o resto além dos
 * props do depósito. Medido ao vivo: **2784 ms** de bloqueio síncrono do main
 * thread (33 espécies, 177 programas), virando um quadro de 2338,9 ms real
 * (`quadro #324`) — em `compileAsync` nesta combinação GPU/driver (GTX 1660
 * Ti via ANGLE/D3D11), "Async" no nome não é garantia nenhuma de não travar:
 * o custo apareceu inteiro, de uma vez, num `requestAnimationFrame` só.
 *
 * Isto SEMPRE aconteceu atrás da cortina (este componente só existe montado
 * enquanto `aquecendo` — `precompilarProps={aquecendo}` em `PlayView.tsx` —
 * então o jogador nunca via o resultado), mas um bloqueio de quase 3s é
 * exatamente o tipo de tarefa longa que arrisca perder o pong do heartbeat
 * do gateway (ver `net/gateway.ts`, `instalarDiagnosticoDeConexao`) — 2,3-2,8s
 * é uma fração e tanto do `pingTimeout` padrão do socket.io.
 *
 * A troca: em vez de UM `compileAsync(scene, ...)` cobrindo tudo, compila
 * UMA espécie por `requestAnimationFrame` — `gl.compileAsync(alvo, camera)`
 * com `alvo` = o `Object3D` de UM prop do depósito (não a cena inteira), lido
 * direto de `group.children[i]`. Menor escopo (não re-percorre terreno/céu/
 * espécies já compiladas) E espalhado — nenhum quadro paga mais que uma
 * espécie. 33 espécies a ~60fps é ~550ms de RELÓGIO, mas fatiado em ~33
 * pedaços que cabem cada um dentro de um quadro, não uma tacada só.
 */

/** onde as instâncias de aquecimento ficam: fora do frustum, sob o mapa */
export const Y_DEPOSITO = -10_000;

/**
 * Uma instância por ESPÉCIE — milhares de props do mapa usam dezenas de urls.
 *
 * Desmontar depois NÃO desfaz o trabalho: o `PropInstance` clona a cena do
 * glTF mas o MATERIAL vem por referência do cache do `useGLTF` e é
 * compartilhado, então tirar os clones da cena não descarta material nenhum e o
 * programa compilado continua no renderer. É essa partilha que faz a
 * pré-compilação valer para os props de verdade que aparecerem depois.
 */
export function especies(props: readonly MapProp[]): MapProp[] {
  const vistas = new Set<string>();
  const fora: MapProp[] = [];
  for (const p of props) {
    if (vistas.has(p.assetId)) continue;
    vistas.add(p.assetId);
    fora.push({
      ...p,
      id: `precompilar:${p.assetId}`,
      position: [0, Y_DEPOSITO, 0],
      // a rotação e a escala do original não importam para o material, e
      // normalizá-las evita que uma escala 0 do mapa esconda a malha
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
  }
  return fora;
}

export function PreCompilarProps({ map }: { map: GameMap }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const lista = useMemo(() => especies(map.props), [map.props]);
  const grupoRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (lista.length === 0) return;
    let vivo = true;
    let indice = 0;
    let rafId = 0;
    const t0 = performance.now();

    /**
     * Um `Object3D` do depósito por vez — não a cena inteira.
     *
     * `group.children[i]` é o `<primitive>` que `PropInstance` monta para
     * UMA espécie (ver `props/PropInstance.tsx`); pode ter vários meshes
     * (casca+folha) por baixo, e `compileAsync`/`compile` desce por
     * `traverseVisible` neles todos sozinho — não precisa listar mesh a
     * mesh aqui.
     *
     * Roda no PRÓXIMO quadro, não neste — o efeito comita ANTES de o R3F ter
     * montado os `<primitive>` de verdade na árvore (mesma razão de sempre).
     */
    const compilarProximo = () => {
      if (!vivo) return;
      const grupo = grupoRef.current;
      const alvo = grupo?.children[indice];
      if (!alvo) {
        registrarEvento("cena", "precompilou", {
          especies: lista.length,
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
        return;
      }
      indice++;
      // `compile` síncrono é o caminho de quem não tem `compileAsync` (three
      // antigo): pior, mas ainda atrás da cortina, que é o que importa
      const pronto = gl.compileAsync
        ? gl.compileAsync(alvo, camera)
        : (gl.compile(alvo, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        if (!vivo) return;
        rafId = requestAnimationFrame(compilarProximo);
      });
    };
    rafId = requestAnimationFrame(compilarProximo);
    return () => {
      vivo = false;
      cancelAnimationFrame(rafId);
    };
  }, [gl, camera, lista]);

  return (
    <group name="precompilar" ref={grupoRef}>
      {lista.map((p) => (
        // o mesmo `<Suspense>` por prop do mundo real: um `.glb` que ainda não
        // chegou não pode derrubar a cena, nem aqui
        <Suspense key={p.id} fallback={null}>
          <PropInstance prop={p} />
        </Suspense>
      ))}
    </group>
  );
}
