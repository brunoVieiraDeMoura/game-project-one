import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import { cellToWorld, type LegacyMapping } from "../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../net/worldStore";
import { gateway } from "../net/gateway";
import { proximoAlvo, type AlvoCandidato } from "./cicloDeAlvo";

/**
 * TAB seleciona o inimigo; TAB de novo, o próximo.
 *
 * Só SELECIONA — não ataca. É a mesma coisa que clicar no monstro: a placa do
 * alvo aparece e o `attackStore` fica de fora. Quem transforma seleção em golpe
 * é o Ataque Básico (`hud/SkillBar`), e essa separação é o que deixa o jogador
 * mirar antes de decidir.
 *
 * Componente porque precisa da CÂMERA — "para onde se está olhando pesa mais" é
 * metade da regra, e ela não existe fora do `<Canvas>`. A outra metade (a
 * ordenação) é pura e mora em `play/cicloDeAlvo`.
 */
export function AlvoPorTab({ map, mapping, fogFar }: { map: GameMap; mapping: LegacyMapping; fogFar: number }) {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      // digitando no chat, Tab é do navegador (e do campo de texto)
      const alvoDom = e.target as HTMLElement | null;
      const tag = alvoDom?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || alvoDom?.isContentEditable) return;
      // sem isto o Tab passeia pelo foco dos elementos do HUD e tira o teclado
      // da cena — o navegador o trata como navegação, não como tecla de jogo
      e.preventDefault();

      const mundo = useWorldStore.getState();
      const agora = performance.now();

      /**
       * Para onde a câmera olha, no PLANO DO CHÃO.
       *
       * A câmera do jogo é inclinada, então o vetor de direção dela aponta para
       * baixo; usá-lo cru faria todo alinhamento encolher pelo cosseno da
       * inclinação, e o peso da câmera valeria menos do que diz. Projetado em
       * XZ, o número volta a significar "está na minha frente".
       */
      const olhar = camera.getWorldDirection(new THREE.Vector3());
      olhar.y = 0;
      if (olhar.lengthSq() < 1e-6) return;
      olhar.normalize();

      const eu = mundo.self;
      const meuCel = interpolatedCell(eu, agora);
      const meuMundo = cellToWorld(map, mapping, meuCel.x, meuCel.y);

      const candidatos: AlvoCandidato[] = [];
      for (const gid of mundo.gids) {
        const e2 = mundo.entities[gid];
        // só MONSTRO: NPC e outros jogadores não são alvo de ciclo de combate
        if (!e2 || e2.kind !== "mob" || gid === mundo.selfGid) continue;
        const cel = interpolatedCell(e2, agora);
        const w = cellToWorld(map, mapping, cel.x, cel.y);
        const dx = w.x - meuMundo.x;
        const dz = w.z - meuMundo.z;
        const dist = Math.hypot(dx, dz);
        candidatos.push({
          gid,
          // em CÉLULAS, que é a unidade em que `PESO_CAMERA` foi calibrado
          distancia: dist / 2,
          // colado no personagem não há direção que signifique alguma coisa:
          // conta como "à frente" para não virar ruído
          alinhamento: dist < 1e-3 ? 1 : (dx * olhar.x + dz * olhar.z) / dist,
          visivel: dist <= fogFar,
        });
      }

      const proximo = proximoAlvo(candidatos, mundo.target);
      // campo vazio não é motivo para largar o mob já mirado
      if (proximo === null) return;
      mundo.setTarget(proximo);
      // nome, nível e HP do mob vêm do ACK_REQNAME, não do spawn — sem pedir, a
      // placa do alvo abre com "?" e barra vazia
      gateway().emit("entity:info", { gid: proximo });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, map, mapping, fogFar]);

  return null;
}
