/**
 * A moldura NOVA de `/login` e `/char-select` (`ui_definitiva/login-new`,
 * next-change.txt "substituir a ui do login... pelas novas peças").
 *
 * Antes as duas telas emprestavam a moldura do CHAT (`hud/ChatFrame`, os
 * quatro cantos byte a byte iguais aos dele) — funcionava, mas não era arte
 * FEITA para esta tela. Este pacote traz peça própria: dois cantos (login e
 * "canva", o painel de personagens) e as faixas que preenchem entre eles.
 *
 * Todo arquivo aqui já veio RECORTADO rente ao conteúdo (bounding box do
 * alpha == canvas inteiro, conferido com sharp) — nenhuma medida de recorte a
 * fazer, diferente do pacote do chat.
 */

const BASE = "/assets/ui/login2";

export const LOGIN2_ART = {
  /** canto superior-esquerdo do painel de LOGIN — vine fina sobre poste */
  loginTop: `${BASE}/borda-top-login.png`,
  /** canto inferior-esquerdo do painel de LOGIN */
  loginBottom: `${BASE}/borda-bot-login.png`,
  /** faixa vertical (madeira) que preenche o vão entre os cantos do login */
  loginRail: `${BASE}/barra-login.png`,
  /** canto superior-esquerdo do painel "canva" (char-select) */
  canvaTop: `${BASE}/borda-top-canva.png`,
  /** borda INFERIOR inteira do painel canva — larga o bastante pra cobrir a
   * base toda esticada, então o canva não precisa de canto-inferior separado */
  canvaBottom: `${BASE}/borda-bot-canva.png`,
  /** faixa vertical do canva */
  canvaRail: `${BASE}/barra-canva.png`,
  /** ponta arredondada do botão-cápsula */
  buttonCap: `${BASE}/borda-botao.png`,
  /** miolo esticável do botão-cápsula */
  buttonFill: `${BASE}/barra-botao.png`,
} as const;

/** tamanho nativo (px), já = bounding box do alpha */
export const LOGIN2_SIZE = {
  loginTop: { w: 71, h: 124 },
  loginBottom: { w: 105, h: 127 },
  loginRail: { w: 18, h: 70 },
  canvaTop: { w: 158, h: 157 },
  canvaBottom: { w: 275, h: 140 },
  canvaRail: { w: 19, h: 110 },
  buttonCap: { w: 32, h: 29 },
  buttonFill: { w: 8, h: 25 },
} as const;
