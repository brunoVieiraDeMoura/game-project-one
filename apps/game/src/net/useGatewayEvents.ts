import { useEffect } from "react";
import { gateway, type CharSummary, type FriendPayload, type GuildMemberPayload } from "./gateway";
import { useSessionStore } from "./sessionStore";
import { usePlayerStore } from "./playerStore";
import { useCastStore } from "./castStore";
import { useCooldownStore } from "./cooldownStore";
import { useFriendStore } from "./friendStore";
import { useWorldStore } from "./worldStore";
import { useGroundItems } from "./GroundItems";
import { useAttackStore } from "./attackStore";
import { usePickupStore } from "./pickupStore";
import { useSkillWalkStore } from "./skillWalkStore";
import { bindToCharacter, unbindCharacter } from "../hud/skillBarStore";
import {
  bindToCharacter as bindCombatVisualsToCharacter,
  unbindCharacter as unbindCombatVisuals,
} from "../hud/combatVisualsStore";

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
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info(`[GAME_LOAD] T0 world:enter mapa="${p.mapName}" t=${Math.round(performance.now())}ms`);
      }
      useSessionStore.getState().setWorld(p);
      /**
       * Entrar num mapa esquece o mundo que ficou para trás.
       *
       * `world:enter` é o `ZC_NPCACK_MAPMOVE` do rAthena, e ele chega TAMBÉM
       * quando o destino é o mapa ATUAL (`pc_setpos`, pc.cpp:7118) — `@jump`,
       * warp de NPC interno, Asa de Borboleta e morte-e-respawn no mesmo mapa.
       *
       * Nesse caso não há vanish nenhum a esperar: o rAthena não manda
       * `NOTIFY_VANISH` por entidade ao teleportar (só o
       * `clif_clearunit_area(*sd, CLR_TELEPORT)`, que fala dos OUTROS para este
       * jogador), e o gateway já esqueceu o snapshot dele
       * (`this.entities.clear()` no hook do MAPMOVE). Sem limpar aqui, as ~13
       * entidades que estavam à vista ficavam no store PARA SEMPRE, congeladas
       * na última célula — e cada warp somava outras tantas. Era o "parece ter
       * muito mais monstro do que o mapa tem".
       *
       * Trocar de MAPA escapava por acidente (o `mapId` muda → `useMap` devolve
       * `null` → o `WorldEventsBridge` desmonta → o `clear()` da limpeza roda),
       * o que é frágil demais para ser a regra. Agora os dois casos passam pelo
       * mesmo caminho, e o do mapa novo só limpa o que já estava vazio.
       *
       * `limparEntidades` e não `clear`: o `self` tem de sobreviver, porque
       * quem reposiciona o personagem num warp de mesmo mapa é o `self:warp`
       * que vem LOGO ATRÁS deste evento.
       */
      useWorldStore.getState().limparEntidades();
      useGroundItems.getState().clear();
      /**
       * E as ordens de vários quadros morrem junto.
       *
       * Elas guardam CÉLULA e GID do mapa de onde o jogador acabou de sair. O gid
       * some com as entidades, mas a célula da magia pendente continuaria
       * perfeitamente válida no mapa novo — o personagem chegaria em Prontera e
       * sairia andando até um ponto que ninguém escolheu, para lançar uma skill
       * que ele pediu noutro lugar. Vale para o warp de MESMO mapa também: o
       * `pc_setpos` o pôs longe, e a ordem antiga o traria de volta.
       */
      useSkillWalkStore.getState().parar();
      useAttackStore.getState().parar();
      usePickupStore.getState().parar();
      // Nível, zeny, classe e atributos iniciais vêm daqui (o servidor só manda
      // pacote quando MUDAM). Sem isso o HUD abria "Nv 1" ao lado do HP real.
      if (p.char) usePlayerStore.getState().seedFromChar(p.char);
      // `p.gid` é o char id (não o account id — ver o comentário sobre isso em
      // `useWorldEvents.ts`). Amarra a barra de habilidades a ESTE personagem
      // ANTES do `world:ready`: o `hotkey:list` que o servidor manda em
      // resposta precisa achar o binding já certo, senão sincroniza pro
      // personagem errado (ou pro nenhum).
      bindToCharacter(p.gid);
      bindCombatVisualsToCharacter(p.gid);
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
      useFriendStore.getState().reset();
      // Desvincula a barra de habilidades do personagem — sem isso ela
      // continuava visível (e gravável) no próximo personagem que logasse
      // neste mesmo navegador.
      unbindCharacter();
      unbindCombatVisuals();
      useSessionStore.getState().setError(motivo);
    };
    const onClosed = (p: { reason: string }) => encerrar(p.reason);

    // Amigos, guilda e ignorados moram AQUI e não em `useWorldEvents`: a lista
    // de amigos é despejada em `pc_authok` (pc.cpp:2252), antes de a cena 3D
    // existir, e o gateway a reenvia no `world:ready` — quem escuta tem que
    // estar montado desde o login.
    const fs = () => useFriendStore.getState();
    const onFriends = (p: FriendPayload[]) => fs().setFriends(p);
    const onFriendState = (p: { accountId: number; charId: number; online: boolean }) =>
      fs().setFriendState(p);
    const onFriendRequest = (p: { accountId: number; charId: number; name: string }) =>
      fs().setPedido(p);
    const onFriendAdded = (p: { reason: string; friend: FriendPayload | null }) => {
      if (p.friend) fs().addFriend(p.friend);
      fs().setAviso(p.reason);
    };
    const onFriendRemoved = (p: { accountId: number; charId: number }) => fs().removeFriend(p);
    const onGuild = (p: GuildMemberPayload[]) => fs().setGuild(p);
    const onIgnore = (p: string[]) => fs().setIgnored(p);
    const onDisconnect = () => encerrar("conexão com o gateway caiu");

    socket.on("connect", onConnect);
    socket.on("auth:ok", onAuthOk);
    socket.on("auth:error", onAuthError);
    socket.on("char:list", onCharList);
    socket.on("char:error", onCharError);
    socket.on("world:enter", onWorld);
    socket.on("session:closed", onClosed);
    socket.on("disconnect", onDisconnect);
    socket.on("friend:list", onFriends);
    socket.on("friend:state", onFriendState);
    socket.on("friend:request", onFriendRequest);
    socket.on("friend:added", onFriendAdded);
    socket.on("friend:removed", onFriendRemoved);
    socket.on("guild:members", onGuild);
    socket.on("ignore:list", onIgnore);

    return () => {
      socket.off("connect", onConnect);
      socket.off("auth:ok", onAuthOk);
      socket.off("auth:error", onAuthError);
      socket.off("char:list", onCharList);
      socket.off("char:error", onCharError);
      socket.off("world:enter", onWorld);
      socket.off("session:closed", onClosed);
      socket.off("disconnect", onDisconnect);
      socket.off("friend:list", onFriends);
      socket.off("friend:state", onFriendState);
      socket.off("friend:request", onFriendRequest);
      socket.off("friend:added", onFriendAdded);
      socket.off("friend:removed", onFriendRemoved);
      socket.off("guild:members", onGuild);
      socket.off("ignore:list", onIgnore);
    };
  }, []);
}
