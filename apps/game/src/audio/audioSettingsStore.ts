import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Volume central do áudio do jogo — duas categorias independentes que
 * `audio/mapAmbience` e `audio/footsteps` leem ao vivo (nenhum componente tem
 * volume próprio):
 *
 *  - `musicVolume`: música ambiente de mapa (`MapAmbience`).
 *  - `sfxVolume`: tudo mais — passos (`footsteps`), natureza/ambiente
 *    (também `MapAmbience`, canal separado do musical) e qualquer SFX futuro
 *    que vier a se integrar aqui.
 *
 * GLOBAL de propósito, diferente de `hud/skillBarStore`/`combatVisualsStore`
 * (que são POR PERSONAGEM): volume é preferência do NAVEGADOR/DISPOSITIVO,
 * mesmo espírito de `ui/LoginMusic` — trocar de personagem ou de conta não
 * deveria resetar o que o jogador já ajustou. Por isso o `persist` aqui usa
 * `localStorage` puro, sem o adapter `charAtual` dos outros dois.
 */
interface AudioSettingsState {
  /** 0..1 */
  musicVolume: number;
  /** 0..1 */
  sfxVolume: number;
  setMusicVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
}

/** mesmos valores que já eram as constantes fixas antes deste store existir
 * (`MUSIC_VOLUME`/`AMBIENT_VOLUME` em `mapAmbience`, `FOOTSTEP_VOLUME` em
 * `footsteps`) — o padrão não muda pra quem nunca abriu Configurações */
const PADRAO: Pick<AudioSettingsState, "musicVolume" | "sfxVolume"> = {
  musicVolume: 0.35,
  sfxVolume: 0.55,
};

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export const useAudioSettings = create<AudioSettingsState>()(
  persist(
    (set) => ({
      ...PADRAO,
      setMusicVolume: (v) => set({ musicVolume: clamp01(v) }),
      setSfxVolume: (v) => set({ sfxVolume: clamp01(v) }),
    }),
    {
      name: "ragnarok:audio-settings",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ musicVolume: s.musicVolume, sfxVolume: s.sfxVolume }),
    },
  ),
);

/**
 * Leitura fora do React — `mapAmbience`/`footsteps` são módulos-singleton,
 * não componentes, e chamar `useAudioSettings.getState()` direto em todo
 * lugar espalharia o mesmo acesso repetido; estas duas funções são só o nome
 * que se lê no call site.
 */
export function getMusicVolume(): number {
  return useAudioSettings.getState().musicVolume;
}
export function getSfxVolume(): number {
  return useAudioSettings.getState().sfxVolume;
}
