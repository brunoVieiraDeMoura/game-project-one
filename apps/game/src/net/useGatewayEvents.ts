import { useEffect } from "react";
import { gateway, type CharSummary } from "./gateway";
import { useSessionStore } from "./sessionStore";
import { usePlayerStore } from "./playerStore";
import { useCastStore } from "./castStore";
import { useCooldownStore } from "./cooldownStore";

/**
 * Liga os eventos de conta/personagem/mundo no sessionStore.
 *
 * Monta uma vez no App (não por rota): a sessão do rAthena mora no socket, e
 * desmontar no meio da troca de tela perderia o `world:enter` que chega logo
 * depois do `char:select`.
 */
export function useGatewayEvents(): void {
  useEffect(() => {
    const socket = gateway();
    const store = useSessionStore.getState();

    const onConnect = () => {
      if (useSessionStore.getState().phase === "offline") {
        useSessionStore.getState().setPhase("connecting");
      }
    };
    const onAuthOk = (p: { accountId: number; sex: number }) => store.setAccount(p.accountId, p.sex);
    const onAuthError = (p: { reason: string }) => {
      useSessionStore.getState().setError(p.reason);
      useSessionStore.getState().setPhase("offline");
    };
    const onCharList = (p: { chars: CharSummary[]; slots: number }) =>
      useSessionStore.getState().setChars(p.chars, p.slots);
    const onCharError = (p: { reason: string }) => useSessionStore.getState().setError(p.reason);
    const onWorld = (p: Parameters<typeof store.setWorld>[0]) => {
      useSessionStore.getState().setWorld(p);
      // Nível, zeny, classe e atributos iniciais vêm daqui (o servidor só manda
      // pacote quando MUDAM). Sem isso o HUD abria "Nv 1" ao lado do HP real.
      if (p.char) usePlayerStore.getState().seedFromChar(p.char);
      // Avisa o servidor que o cliente entrou no mapa (CZ.NOTIFY_ACTORINIT).
      // Vai daqui, e não da cena 3D, porque o rAthena só considera o
      // personagem ATIVO depois disto: sem o aviso ele ignora chat, comando de
      // GM e movimento — e o jogador ficava preso quando o mapa não tinha
      // correspondente em 3D.
      socket.emit("world:ready");
    };
    // Cronômetros presos a `performance.now()` (conjuração, recarga) precisam
    // morrer junto com a sessão: sem isso a barra de cast fica congelada na
    // tela de login com o nome da última skill.
    const encerrar = (motivo: string) => {
      useSessionStore.getState().reset();
      usePlayerStore.getState().reset();
      useCastStore.getState().parar();
      useCooldownStore.getState().clear();
      useSessionStore.getState().setError(motivo);
    };
    const onClosed = (p: { reason: string }) => encerrar(p.reason);
    const onDisconnect = () => encerrar("conexão com o gateway caiu");

    socket.on("connect", onConnect);
    socket.on("auth:ok", onAuthOk);
    socket.on("auth:error", onAuthError);
    socket.on("char:list", onCharList);
    socket.on("char:error", onCharError);
    socket.on("world:enter", onWorld);
    socket.on("session:closed", onClosed);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("auth:ok", onAuthOk);
      socket.off("auth:error", onAuthError);
      socket.off("char:list", onCharList);
      socket.off("char:error", onCharError);
      socket.off("world:enter", onWorld);
      socket.off("session:closed", onClosed);
      socket.off("disconnect", onDisconnect);
    };
  }, []);
}
