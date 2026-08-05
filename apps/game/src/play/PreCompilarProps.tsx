import { Suspense, useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { GameMap, MapProp } from "@ragnarok/map-format";
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
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const lista = useMemo(() => especies(map.props), [map.props]);

  useEffect(() => {
    if (lista.length === 0) return;
    let vivo = true;
    const t0 = performance.now();
    /**
     * Num quadro seguinte, não neste.
     *
     * O efeito roda no commit, ANTES de o R3F ter montado os objetos na cena —
     * compilar agora percorreria uma cena que ainda não tem os props. Um
     * `requestAnimationFrame` basta: no próximo quadro eles estão lá.
     */
    const id = requestAnimationFrame(() => {
      if (!vivo) return;
      // `compile` síncrono é o caminho de quem não tem `compileAsync` (three
      // antigo): pior, mas ainda atrás da cortina, que é o que importa
      const pronto = gl.compileAsync
        ? gl.compileAsync(scene, camera)
        : (gl.compile(scene, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        if (!vivo) return;
        registrarEvento("cena", "precompilou", {
          especies: lista.length,
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
      });
    });
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [gl, scene, camera, lista]);

  return (
    <group name="precompilar">
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
