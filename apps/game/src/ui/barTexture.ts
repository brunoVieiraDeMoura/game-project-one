import { useEffect, useState } from "react";
import * as THREE from "three";
import { BAR_FRAME } from "./charFrame";

/**
 * A moldura curva das barras de HP/SP como TEXTURA, para as barras que vivem na
 * CENA 3D (plaquinha do mob, barras embaixo do personagem).
 *
 * Por que não dá para reusar `ui/nineSlice.ts`: aquele monta um atlas pequeno
 * para `border-image`, que é CSS. No mundo 3D a barra é um plano com material —
 * não há `border-image`, e esticar o atlas de 56×56 num plano largo deformaria
 * os cantos. Aqui a moldura é composta JÁ no tamanho final: os quatro cantos em
 * tamanho fixo e só os trechos retos esticados, que é o que o 9-slice faz.
 *
 * O miolo fica TRANSPARENTE de propósito: quem pinta o trilho e o preenchimento
 * são planos por baixo, senão não daria para animar o HP.
 *
 * A arte é a mesma das barras da placa do personagem (`assets-new/.../
 * skill-cast` é byte a byte `curva-das-bordas-barra-hp-sp` +
 * `reta-barra-hp-sp`, md5 conferido) — nenhum arquivo novo entra no repo.
 */

/** altura da textura em px; a largura sai da proporção pedida */
const ALTURA_TEXTURA = 48;

const cache = new Map<string, THREE.CanvasTexture>();
const pendente = new Map<string, Promise<THREE.CanvasTexture | null>>();

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`falhou ao carregar ${src}`));
    img.src = src;
  });
}

async function montar(proporcao: number): Promise<THREE.CanvasTexture> {
  const H = ALTURA_TEXTURA;
  const W = Math.max(H, Math.round(H * proporcao));
  // mesma regra da `CurvedBar` do HUD: o canto ocupa 38% da altura, e o traço
  // um terço dele — é o que reproduz a proporção da arte em qualquer tamanho
  const C = Math.max(4, Math.round(H * 0.38));
  const T = Math.max(2, Math.round(C / 3));

  const [canto, reto] = await Promise.all([
    carregar(BAR_FRAME.corner),
    BAR_FRAME.edge ? carregar(BAR_FRAME.edge) : Promise.resolve(null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("sem contexto 2d");

  const S = BAR_FRAME.slice ?? 24;
  // Cantos: fx/fy = -1 espelham. `translate` leva a origem para a borda oposta
  // antes do espelho, senão o desenho sai fora da caixa. A arte só traz o canto
  // SUPERIOR-DIREITO; os outros três são ele espelhado.
  const porCanto = (dx: number, dy: number, fx: number, fy: number) => {
    g.save();
    g.translate(dx + (fx < 0 ? C : 0), dy + (fy < 0 ? C : 0));
    g.scale(fx, fy);
    g.drawImage(canto, BAR_FRAME.cornerSx, 0, S, S, 0, 0, C, C);
    g.restore();
  };
  porCanto(W - C, 0, 1, 1);
  porCanto(0, 0, -1, 1);
  porCanto(W - C, H - C, 1, -1);
  porCanto(0, H - C, -1, -1);

  /**
   * Trechos retos. Todos saem do mesmo desenho de traço horizontal, e as bordas
   * verticais são ele GIRADO: no `drawImage` a largura da origem vira o
   * comprimento do destino, então recortar a coluna sairia deitado.
   */
  const traco = (dw: number, dh: number) => {
    if (reto) g.drawImage(reto, 0, 0, reto.naturalWidth, reto.naturalHeight, 0, 0, dw, dh);
    else g.drawImage(canto, BAR_FRAME.cornerSx - BAR_FRAME.edgeThickness, 0, BAR_FRAME.edgeThickness, BAR_FRAME.edgeThickness, 0, 0, dw, dh);
  };
  const meioH = Math.max(1, W - C * 2);
  const meioV = Math.max(1, H - C * 2);

  g.save(); // topo
  g.translate(C, 0);
  traco(meioH, T);
  g.restore();

  g.save(); // base
  g.translate(C, H);
  g.scale(1, -1);
  traco(meioH, T);
  g.restore();

  g.save(); // esquerda
  g.translate(0, C + meioV);
  g.rotate(-Math.PI / 2);
  traco(meioV, T);
  g.restore();

  g.save(); // direita
  g.translate(W, C);
  g.rotate(Math.PI / 2);
  traco(meioV, T);
  g.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // sem repetição: a moldura é uma peça só, e o `clamp` evita o fio da borda
  // oposta aparecer na emenda quando o plano é amostrado no limite
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Textura da moldura para uma barra de proporção `largura / altura`.
 *
 * A textura é cacheada por proporção ARREDONDADA: a barra do mob e a do
 * personagem têm proporções parecidas e não vale gerar um canvas para cada
 * fração — o arredondamento junta as duas numa textura só.
 */
export function useBarFrameTexture(proporcao: number): THREE.CanvasTexture | null {
  const chave = String(Math.round(proporcao));
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(() => cache.get(chave) ?? null);

  useEffect(() => {
    const pronta = cache.get(chave);
    if (pronta) {
      setTex(pronta);
      return;
    }
    let vivo = true;
    let p = pendente.get(chave);
    if (!p) {
      p = montar(Number(chave))
        .then((t) => {
          cache.set(chave, t);
          return t;
        })
        .catch(() => null);
      pendente.set(chave, p);
    }
    p.then((t) => {
      if (vivo && t) setTex(t);
    });
    return () => {
      vivo = false;
    };
  }, [chave]);

  return tex;
}
