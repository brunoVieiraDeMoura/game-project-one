import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "./editorStore";
import { findBlockedClusters, summarizeClusters } from "./blockedClusters";
import { cellInScope } from "./editScope";
import { RpgButton, ink } from "../ui/rpg";

/**
 * Limpeza do terreno bloqueado MIÚDO de um mapa importado do rAthena.
 *
 * O mapa do servidor traz como bloqueio cada arbusto e cada pedra avulsa do
 * mapa original — manchas de uma a quatro células espalhadas pelo campo. Elas
 * não viram nada em 3D e só atrapalham quem vai autorar por cima, então este
 * painel apaga todas de uma vez e deixa chão andável no lugar.
 *
 * As manchas GRANDES ficam: são encosta, construção e o cinturão da borda —
 * essas têm tratamento próprio.
 *
 * Atenção: quem decide onde se anda é o servidor. Enquanto o `map_cache` do
 * rAthena não for regerado, as células limpas continuam bloqueadas para ele.
 */
export function BlockedPanel() {
  const map = useEditorStore((s) => s.map);
  const escopo = useEditorStore((s) => s.editScope);
  const limpar = useEditorStore((s) => s.clearSmallBlocked);
  const zerar = useEditorStore((s) => s.clearAll);
  // confirmação de dois passos: um clique acidental aqui apaga 400×400 de
  // trabalho, e o Ctrl+Z só salva quem perceber na hora
  const [armado, setArmado] = useState(false);
  // sem isso, armar e se distrair deixava o botão "Tem certeza?" plantado
  // pra sempre — um clique BEM depois, sem lembrar do primeiro, zerava o
  // mapa achando que era o primeiro clique de novo
  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(t);
  }, [armado]);

  // recontar 160.000 células a cada render seria caro; só muda quando o mapa muda
  const resumo = useMemo(() => {
    if (!map) return null;
    const clusters = findBlockedClusters(map);
    /**
     * MESMO predicado de `clearSmallBlocked` (editorStore.ts): célula a
     * célula, via `cellInScope` — não `cluster.onBorder`.
     *
     * `cluster.onBorder` (`blockedClusters.ts`) só marca uma mancha como
     * "borda" se ela toca literalmente a última linha/coluna do array — bem
     * mais estreito que a noção usada em todo o resto do editor
     * (`editScope.ts: borderMask`, o cinturão inteiro por flood fill). Com o
     * campo antigo, o resumo mostrado aqui não batia com o que "Remover
     * bloqueios" de fato limpava, e "Buraco" não filtrava nada (caía no
     * mesmo caminho de "Tudo").
     */
    const noEscopo = (cluster: (typeof clusters)[number]) =>
      cluster.cells.some(([col, row]) => cellInScope(map, escopo, col, row));
    const escolhidos = clusters.filter(noEscopo);
    const contagem = summarizeClusters(escolhidos);
    const miudas = escolhidos.filter((c) => c.kind !== "structure");
    // células de fato limpáveis: só as que caem no escopo célula a célula —
    // uma mancha de 2-4 pode ter só parte dela dentro
    const celulas = miudas.reduce(
      (a, c) => a + c.cells.filter(([col, row]) => cellInScope(map, escopo, col, row)).length,
      0,
    );
    return { contagem, manchas: miudas.length, celulas };
  }, [map, escopo]);

  if (!map || !resumo) return null;

  return (
    <div style={{ maxHeight: "48vh", overflow: "auto" }}>
      <div style={{ font: "10px system-ui", color: ink.faint, marginBottom: 8 }}>
        O mapa do servidor marca cada arbusto e pedra do original como bloqueio. Isto apaga os
        miúdos e deixa chão andável; as manchas grandes (encosta, construção, borda) ficam.
      </div>

      <div style={{ font: "10px system-ui", color: ink.dim, marginBottom: 8 }}>
        Vale no escopo escolhido na barra de cima:{" "}
        <b style={{ color: ink.text }}>
          {escopo === "inside" ? "dentro do mapa" : escopo === "border" ? "bordas" : escopo === "hole" ? "buracos" : "tudo"}
        </b>
        {escopo === "hole" && " — mas buraco nunca é limpo aqui, então o total sempre dá zero"}.
      </div>

      <div style={{ font: "11px system-ui", color: ink.text, marginBottom: 2 }}>
        {resumo.manchas.toLocaleString("pt-BR")} manchas miúdas · {resumo.celulas.toLocaleString("pt-BR")} células
      </div>
      <div style={{ font: "10px system-ui", color: ink.faint, marginBottom: 10 }}>
        {resumo.contagem.small} de 1 célula · {resumo.contagem.medium} de 2–4 · {resumo.contagem.large} em 2×2 ·{" "}
        {resumo.contagem.structure} grandes ficam
      </div>

      <RpgButton
        color="blue"
        disabled={resumo.manchas === 0}
        title={resumo.manchas === 0 ? "Nada pra limpar neste escopo" : undefined}
        onClick={limpar}
        style={{ width: "100%" }}
      >
        Remover bloqueios (1 célula, 2–4, 2×2)
      </RpgButton>
      <div style={{ font: "10px system-ui", color: "#fbbf24", marginTop: 8 }}>
        Muda a colisão do mapa 3D. O servidor só deixa de barrar essas células quando o
        map_cache do rAthena for regerado.
      </div>

      <div style={{ borderTop: `1px solid ${ink.faint}`, opacity: 0.4, margin: "14px 0 10px" }} />

      <div style={{ font: "11px system-ui", color: ink.text, marginBottom: 2 }}>
        Começar do zero
      </div>
      <div style={{ font: "10px system-ui", color: ink.faint, marginBottom: 8 }}>
        Deixa o mapa inteiro ({map.size.width}×{map.size.height}) plano e andável: apaga relevo,
        colisão, superfícies, props, spawns e gatilhos. Não vale o escopo — é o mapa todo.
      </div>

      <RpgButton
        color="brown"
        active={armado}
        onClick={() => {
          if (!armado) return setArmado(true);
          zerar();
          setArmado(false);
        }}
        style={{ width: "100%" }}
      >
        {armado ? "Tem certeza? Clique de novo" : "Zerar o mapa inteiro"}
      </RpgButton>
      <div style={{ font: "10px system-ui", color: ink.faint, marginTop: 6 }}>
        Ctrl+Z desfaz enquanto não salvar. Depois de salvar, o servidor só concorda com o mapa
        novo depois do <b style={{ color: ink.dim }}>export:mapcache</b> e do restart do rAthena —
        até lá o chão parece livre e o personagem esbarra em parede invisível.
      </div>
    </div>
  );
}
