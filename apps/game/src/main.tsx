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

/**
 * Os listeners do gateway ficam AQUI, acima do router: a sessão do rAthena mora
 * no socket e a troca de tela (login → char-select → play) acontece no meio do
 * handshake. Montar por rota perderia o `world:enter`, que chega logo depois do
 * `char:select`.
 */
function App({ children }: { children?: ReactNode }) {
  useGatewayEvents();
  return <>{children ?? <Outlet />}</>;
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
