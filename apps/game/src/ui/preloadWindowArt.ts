/**
 * Aquece o cache HTTP do navegador para a arte das janelas que só MONTAM na
 * primeira abertura (`hud/Windows.tsx`: Inventário, Habilidades, Amigos,
 * Missões, Mapa, Status — nenhuma delas existe na árvore até o jogador
 * apertar Alt+E/S/Z/U/M/A pela primeira vez).
 *
 * As janelas sempre-montadas (PlayerFrame, Chat, Minimap, SkillBar, MenuBar)
 * já aquecem a própria arte (`charFrame`/`chatFrame`/`minimap`/`skillBar`/
 * `toolIcons`) só de existir no HUD — não repetidas aqui. Isto cobre só o que
 * sobra: `bag`/`friends`/`skills`/`quest`/`mapWindow`/`status`.
 *
 * Mesma receita do `assets.ts: preloadAssets()` (chamado do mesmo lugar,
 * `PlayView.tsx`, no topo do módulo) — fire-and-forget, sem Promise
 * aguardada por ninguém: `new Image().src = url` só pede o byte e deixa o
 * cache HTTP do navegador guardar. Quando a janela montar de verdade e o CSS
 * (`backgroundImage: url(...)`) pedir a MESMA url, o navegador serve do
 * cache em vez de baixar — sem isto, o primeiro Alt+E/S/Z/U/M/A pagava esse
 * download na hora de abrir. Tolerante a falha: uma url que 404 não tem
 * `onerror` tratado, do mesmo jeito que o resto do projeto (`ui/cursors.ts`,
 * `ui/nineSlice.ts`) — só aquela peça não teria sido pré-buscada, quem abrir
 * a janela ainda a pede na hora, exatamente como pediria sem preload nenhum.
 */
import { BAG_ART } from "./bag";
import { FL_ART } from "./friends";
import { SK_ART, SK_MARK_ART } from "./skills";
import { QT_ART } from "./quest";
import { MAP_ART } from "./mapWindow";
import { ST_ART } from "./status";

function urlsDeArte(...dicionarios: Record<string, string>[]): string[] {
  return dicionarios.flatMap((d) => Object.values(d));
}

const URLS_JANELAS = [
  ...urlsDeArte(BAG_ART, FL_ART, SK_ART, QT_ART, MAP_ART, ST_ART),
  ...SK_MARK_ART.flatMap((m) => [m.tip, m.body]),
];

export function preloadWindowArt() {
  for (const url of URLS_JANELAS) {
    const img = new Image();
    img.src = url;
  }
}
