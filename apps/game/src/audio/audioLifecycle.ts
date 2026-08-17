import { pararTodos as pararStingers } from "./oneShotPool";
import { pararFootstep } from "./footsteps";
import { pararAoDesconectar as pararItemSfx } from "./itemSfx";
import { pararAoDesconectar as pararMultiHit } from "./mage/multiHitCastAudio";
import { pararAoDesconectar as pararOutrasSkillsMago } from "./mage/otherSkillsAudio";
import { pararAoDesconectar as pararMapAmbience } from "./mapAmbience";

/**
 * Cleanup COMPLETO de todo áudio de gameplay — chamar do ÚNICO lugar que já
 * centraliza fim de sessão, `encerrar()` em `net/useGatewayEvents.ts`
 * (`session:closed` do servidor E `disconnect` do socket passam pelos MESMOS
 * dois `socket.on`, então isto já cobre todo caminho de desconexão sem
 * precisar duplicar a chamada por botão ou por evento).
 *
 * Cada módulo de áudio (`oneShotPool`, `footsteps`, `audio/itemSfx`,
 * `audio/mage/multiHitCastAudio`, `audio/mage/otherSkillsAudio`,
 * `audio/mapAmbience`) é um módulo-singleton
 * INDEPENDENTE do ciclo de vida do React — nenhum deles para sozinho só
 * porque `NetPlayer`/`PlayView` desmontou na troca de rota pra `/login`
 * (`mapAmbience` é a única exceção parcial: tem um fade de desmonte, mas
 * gracioso, 700ms — devagar demais pra um disconnect de verdade, daí o
 * `pararAoDesconectar` próprio dela também). Sem este cleanup, um passo em
 * loop, uma voz de combate, um `cast` de mago ou o `hit` atrasado de um Cold
 * Bolt continuavam audíveis (ou disparavam atrasados, via `setTimeout`) por
 * cima da música de `/login` — a "sobreposição" que o pedido reporta.
 */
export function pararTodosOsAudiosDeGameplay(): void {
  pararStingers();
  pararFootstep();
  pararItemSfx();
  pararMultiHit();
  pararOutrasSkillsMago();
  pararMapAmbience();
}
