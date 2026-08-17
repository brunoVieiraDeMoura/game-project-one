import type { Element, Race, Size } from "@ragnarok/game-data";

/**
 * Elemento/raça/tamanho → arquivo em `public/assets/{elements,races,monster-size}/`
 * (acervo `assets-new/skill_icons/{elementos,raças,monster}`, 2026-08-15).
 *
 * Mapa EXPLÍCITO por enum, não por `ELEMENT_LABELS`/`RACE_LABELS` (`game-data/
 * labels.ts`): o acervo não bate 1:1 com o rótulo PT em maiúscula/hífen
 * ("Morto-Vivo.png" vs. label "Morto-vivo", "demi-human.png" vs. "Semi-humano")
 * — usar o rótulo como chave de arquivo quebraria silenciosamente. `player_doram`
 * não tem arquivo no acervo: fica de fora do mapa de propósito (nenhum ícone
 * é melhor que um ícone errado, `hud/MobInfoSlots.tsx` já cai pro placeholder
 * de sigla sozinho quando a função devolve `undefined`).
 */
const ELEMENT_ICON: Record<Element, string> = {
  neutral: "Neutro.png",
  water: "Água.png",
  earth: "Terra.png",
  fire: "Fogo.png",
  wind: "Vento.png",
  poison: "Veneno.png",
  holy: "Sagrado.png",
  shadow: "Sombrio.png",
  ghost: "Fantasma.png",
  undead: "Maldito.png",
};

const RACE_ICON: Partial<Record<Race, string>> = {
  formless: "Amorfo.png",
  undead: "Morto-Vivo.png",
  brute: "Bruto.png",
  plant: "Planta.png",
  insect: "Inseto.png",
  fish: "Peixe.png",
  demon: "Demônio.png",
  demihuman: "demi-human.png",
  angel: "Anjo.png",
  dragon: "Dragão.png",
  player_human: "Humano.png",
};

const SIZE_ICON: Record<Size, string> = {
  small: "small-size.png",
  medium: "medium-size.png",
  large: "large-size.png",
};

export function elementIconSrc(element: Element | undefined): string | undefined {
  return element ? `/assets/elements/${ELEMENT_ICON[element]}` : undefined;
}

export function raceIconSrc(race: Race | undefined): string | undefined {
  const file = race ? RACE_ICON[race] : undefined;
  return file ? `/assets/races/${file}` : undefined;
}

export function sizeIconSrc(size: Size | undefined): string | undefined {
  return size ? `/assets/monster-size/${SIZE_ICON[size]}` : undefined;
}
