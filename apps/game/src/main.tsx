import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { SpectatorView } from "./views/SpectatorView";
import { PlayView } from "./views/PlayView";
import { EditorView } from "./views/EditorView";
import { AssetScalingView } from "./views/AssetScalingView";
import { LoginView } from "./views/LoginView";
import { CharSelectView } from "./views/CharSelectView";
import { useGatewayEvents } from "./net/useGatewayEvents";
import { CursorGlobalStyle, useCursorGlobal } from "./ui/cursorStore";
import { DefaultLoadingManager } from "three";
import { observarCarregamento } from "./core/diagnostics/assetProbe";
import { observarCriacaoDeContexto, observarTarefasLongas } from "./core/diagnostics/rendererProbe";

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
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
