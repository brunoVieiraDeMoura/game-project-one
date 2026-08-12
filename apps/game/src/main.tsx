import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { SpectatorView } from "./views/SpectatorView";
import { PlayView } from "./views/PlayView";
import { EditorView } from "./views/EditorView";
import { AssetScalingView } from "./views/AssetScalingView";
import { ClassPreviewView } from "./views/ClassPreviewView";
import { LoginView } from "./views/LoginView";
import { CharSelectView } from "./views/CharSelectView";
import { useGatewayEvents } from "./net/useGatewayEvents";
import { CursorGlobalStyle, useCursorGlobal } from "./ui/cursorStore";
import { Cache, DefaultLoadingManager } from "three";
import { observarCarregamento } from "./core/diagnostics/assetProbe";
import { observarCriacaoDeContexto, observarTarefasLongas } from "./core/diagnostics/rendererProbe";

/**
 * `THREE.Cache` liga o cache de RECURSO BAIXADO do three — por URL, embaixo
 * de qualquer loader (`ImageLoader`, `ImageBitmapLoader`, `FileLoader`) — e
 * vem DESLIGADO por padrão. Sem isto, a MESMA textura pedida por dois
 * `GLTFLoader.parse()` diferentes (ex.: `CommonTree_1.gltf` e
 * `CommonTree_2.gltf`, que apontam pro MESMO `Bark_NormalTree.png`) dispara
 * DOIS `fetch()` — o three não sabe que já tem aquele byte em voo/pronto.
 *
 * Achado ao investigar o cold load de ~79s (`prt_fild08` usa as 5 variantes
 * de `CommonTree`/`Pine`/`TwistedTree`/`DeadTree`, todas apontando pra só 6
 * PNGs de casca — 4-6 MB cada, 2048²): rede capturada ao vivo mostrou o MESMO
 * `Bark_NormalTree.png` sendo requisitado **~40 vezes**. A causa raiz é uma
 * combinação de duas coisas SEPARADAS:
 *
 * 1. O cache do `useLoader`/`useGLTF` (drei, via `suspend-react`) é chaveado
 *    pelo ARRAY INTEIRO de urls de cada chamada (`[loader, ...urls]`,
 *    igualdade RASA) — `EsperaAssetsDoMapa` (todas as urls do mapa),
 *    `TreeImpostors` (só árvore/arbusto) e `VegetationInstancer` (grama até
 *    árvore) passam arrays DIFERENTES contendo os MESMOS assetIds de árvore,
 *    então cada um é um cache MISS pros outros — 3 `GLTFLoader.parse()`
 *    independentes pro mesmo `.gltf`.
 * 2. Dentro de CADA parse, `CommonTree_1..5`/`Pine_1..5` são 10 ARQUIVOS
 *    `.gltf` distintos que compartilham o MESMO `Bark_NormalTree.png` — o
 *    cache de dependência do `GLTFParser` é POR PARSE, não entre parses.
 *
 * Nenhuma das duas é fácil (nem seria seguro) de reestruturar sem risco —
 * `Cache.enabled` resolve as DUAS de uma vez, no nível mais baixo: por mais
 * vezes que QUALQUER loader peça a mesma URL, só a PRIMEIRA baixa de
 * verdade. Efeito colateral zero no resto do app (nenhum código lê
 * `THREE.Cache` hoje — `grep` confirmado) e é a mesma chave (URL) que o
 * `gltfTexturas.ts` já usa pra deduplicar o objeto `THREE.Texture` — aqui só
 * se deduplica o BYTE antes dele, que é o `gltfTexturas` não alcança (ele
 * roda depois do parse já ter baixado tudo).
 */
Cache.enabled = true;

/**
 * A sonda de carregamento é instalada AQUI, no boot, e não num componente.
 *
 * O `DefaultLoadingManager` é global e é por onde passa todo asset do jogo (o
 * `GLTFLoader` que o drei constrói dentro do `useGLTF` não recebe manager
 * próprio, então cai nele). Instalada mais tarde — num efeito de tela, por
 * exemplo — ela perderia exatamente a carga inicial, que é quando mais coisa
 * está em voo.
 *
 * No topo do módulo, fora do React: o StrictMode remonta efeitos, e
 * `observarCarregamento` é idempotente justamente porque um segundo embrulho
 * contaria cada asset em dobro.
 */
if (import.meta.env.DEV) {
  observarCarregamento(DefaultLoadingManager);
  /**
   * As duas globais, pelo mesmo motivo do carregador: `getContext` é do
   * protótipo do `HTMLCanvasElement` e o `longtask` é do documento. Instaladas
   * num componente, perderiam a criação do PRIMEIRO contexto — que é o do jogo,
   * e é a linha de base contra a qual os retratos são comparados.
   */
  observarCriacaoDeContexto();
  observarTarefasLongas();
}

/**
 * Os listeners do gateway ficam AQUI, acima do router: a sessão do rAthena mora
 * no socket e a troca de tela (login → char-select → play) acontece no meio do
 * handshake. Montar por rota perderia o `world:enter`, que chega logo depois do
 * `char:select`.
 */
function App({ children }: { children?: ReactNode }) {
  useGatewayEvents();
  // cursores pintados no lugar dos do sistema, em TODAS as telas (ver ui/cursors)
  useCursorGlobal();
  return (
    <>
      {/* inputs e botões herdam o cursor pintado em vez do cursor do sistema */}
      <CursorGlobalStyle />
      {children ?? <Outlet />}
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: "/", element: <SpectatorView /> },
      { path: "/spectator", element: <SpectatorView /> },
      { path: "/login", element: <LoginView /> },
      { path: "/char-select", element: <CharSelectView /> },
      { path: "/play", element: <PlayView /> },
      { path: "/editor", element: <EditorView /> },
      { path: "/asset-scaling", element: <AssetScalingView /> },
      { path: "/class-preview", element: <ClassPreviewView /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
