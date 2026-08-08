import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useShallow } from "zustand/react/shallow";
import * as THREE from "three";
import type { GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { CHARACTER_URLS, useCharacter } from "../assets";
import { mobModel, NPC_MODEL } from "../entities/mobModels";
import { gateway } from "./gateway";
import { cellToWorld, type LegacyMapping } from "./legacyCells";
import { fatiaDeRender } from "./entityRenderSlice";
import { interpolatedCell, useWorldStore } from "./worldStore";
import { cliqueVaiParaOChao, useAimStore } from "./aimStore";
import { EntityLabel } from "./EntityLabel";
import { useCursorStore } from "../ui/cursorStore";
import { GlowChao } from "./GlowChao";
import { GEO_CILINDRO, MATERIAL_INVISIVEL } from "./recursosCompartilhados";
import { useSoftLockStore } from "../play/softLockStore";
import { useAttackStore } from "./attackStore";
import { atacar, castarEmAlvo } from "./acoes";
import { pulsoDe } from "./combatAnim";
import { PROPS_GROUP } from "../play/GroundInteract";
import { TERRAIN_GROUP, temLinhaDeVisada } from "../play/pickGround";

/** de quanto em quanto tempo o `__netEntities` do DEV é atualizado */
const DBG_INTERVALO_MS = 500;

/**
 * Área clicável do mob, em fração de CÉLULA (raio) e da altura do modelo.
 *
 * Era 0,42 de célula — o corpo justo. Numa câmera afastada isso é um alvo de
 * poucos pixels, e errar o clique manda o personagem ANDAR até lá em vez de
 * atacar, que é o pior resultado possível. 0,62 dá folga sem invadir a célula
 * vizinha (o raio ainda é menor que 2/3 da célula), e a altura passa do topo da
 * cabeça para poder pegar o clique de cima.
 */
const HITBOX_RAIO = 0.62;
const HITBOX_ALTURA = 1.25;

/**
 * Vermelho do realce de inimigo.
 *
 * Mesma matiz (~8°) do preenchimento de HP do alvo (`ENEMY_FILL`) — a paleta
 * da UI não tem vermelho próprio, e inventar um tom novo faria o realce
 * destoar da placa que ele acende. Mas o STOP do gradiente que era usado
 * antes (`#8a2f22`, o do meio) é escuro e pouco saturado — ele existe para
 * SOMBREAR uma barra, não para brilhar sobre grama. Sobre o chão claro, com o
 * `forca`/`aro` em opacidade parcial, o resultado saía acastanhado e sumia —
 * "o círculo é vermelho mas pouco visível". Este tom sobe saturação e luz na
 * MESMA matiz (mais perto do stop claro do gradiente, `#b05a45`, só que mais
 * puro) para o vermelho realmente ler como vermelho de longe.
 */
const GLOW_INIMIGO = "#e0402a";

/**
 * Uma entidade do servidor desenhada na cena.
 *
 * Não tem IA, não decide para onde anda e não calcula dano: só interpola entre
 * a célula de onde saiu e a célula para onde o servidor disse que vai. Todo o
 * resto (aggro, velocidade, morte, drop) é do map-server.
 */
export function NetEntityView({
  gid,
  map,
  mapping,
  charScale,
  animationSpeed,
  cellSize,
  fogFar,
  terrain,
}: {
  gid: number;
  map: GameMap;
  mapping: LegacyMapping;
  charScale: number;
  animationSpeed: number;
  /** largura da célula em unidades de mundo (plaquinha e hitbox são medidas nela) */
  cellSize: number;
  /** onde a névoa fica opaca — além disto não há o que ver (ver play/viewRadius) */
  fogFar: number;
  /** para o `GlowChao` inclinar pelo relevo sob o mob (item "moldar o alvo") */
  terrain?: TerrainQuery;
}) {
  /**
   * Assina só o que MUDA O DESENHO — nunca a entidade inteira.
   *
   * O `move` do store cria um objeto novo por pacote, e assinando `entities[gid]`
   * cada passo de cada mob re-renderizava esta subárvore toda (área de clique,
   * brilho, plaquinha e a barra de três malhas), com o `<Text>` do drei
   * re-sincronizando o atlas de glifo junto. A posição não passa por render
   * nenhum: ela é escrita no `group.position` do `useFrame` abaixo, que lê o
   * store por `getState()`. Ver `net/entityRenderSlice` e o teste que trava isso
   * dos dois lados em `perf/cenarios.test.ts`.
   */
  const entity = useWorldStore(
    useShallow((s) => {
      const e = s.entities[gid];
      return e ? fatiaDeRender(e) : undefined;
    }),
  );
  const targeted = useWorldStore((s) => s.target === gid);
  const modelInfo = entity?.kind === "npc" ? NPC_MODEL : mobModel(entity?.job ?? 0);
  /**
   * "Esta entidade está à vista?" — escrito no `useFrame` abaixo, lido pelo
   * mixer de animação (ver `assets.useCharacter`). Começa `true` para o primeiro
   * quadro não nascer congelado.
   */
  const aVista = useRef(true);
  const { scene, play, playOnce } = useCharacter(CHARACTER_URLS[modelInfo.character], animationSpeed, aVista);
  /**
   * Montanha/prop na frente barram o CLIQUE, não só a assistência de mira.
   *
   * Sem isto, a hitbox do mob (um cilindro invisível, sem handler nenhum entre
   * ela e a câmera) era testada sozinha — o R3F só raycasta objeto com handler,
   * então o terreno nem entrava na conta e dava para "pegar o target no blind
   * da montanha" clicando direto em cima do mob. Achado por nome uma vez (ver
   * `views/PlayView`, mesmo padrão) e refeito quando o MAPA troca.
   */
  const cenaRaiz = useThree((s) => s.scene);
  const obstaculos = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    const terreno = cenaRaiz.getObjectByName(TERRAIN_GROUP);
    const props = cenaRaiz.getObjectByName(PROPS_GROUP);
    obstaculos.current = [terreno, props].filter((o): o is THREE.Object3D => !!o);
  }, [cenaRaiz, map]);
  const group = useRef<THREE.Group>(null);
  /** só o boneco gira; plaquinha e área de clique ficam paradas */
  const model = useRef<THREE.Group>(null);
  const wasMoving = useRef(false);
  /** pulso de combate (`net/combatAnim`) — mesma gating do `NetPlayer` */
  const ultimoPulsoVisto = useRef(0);
  const ocupadoAte = useRef(0);
  const emCombateAntes = useRef(false);
  /** última escrita no `__netEntities` (DEV) — ver o bloco no `useFrame` */
  const ultimoDbg = useRef(0);
  /** o ponteiro está sobre esta entidade? (para devolver o cursor ao desmontar) */
  const sobre = useRef(false);
  /** o mesmo, mas em estado — o brilho é desenho e precisa de render */
  const [realce, setRealce] = useState(false);
  /**
   * Há uma skill de CHÃO mirando?
   *
   * Enquanto houver, este monstro não é alvo de clique: quem recebe é a célula
   * atrás dele. O seletor devolve booleano (não o objeto da skill), então o
   * zustand só repinta na troca — e a troca acontece por clique na barra de
   * skills, não por quadro.
   */
  const mirandoChao = useAimStore((s) => cliqueVaiParaOChao(s.skill));
  /**
   * A assistência de mira escolheria ESTE mob se o clique saísse agora?
   *
   * É a trava do soft lock, visível. O pedido original era puxar o cursor até o
   * monstro; o navegador não deixa mover o ponteiro do sistema, então o que
   * entrega a mesma informação — "é neste que vou bater" — é acender o alvo
   * antes do clique.
   *
   * Seletor de igualdade (booleano), e o store só publica na TROCA: o alvo é
   * recalculado por quadro, e devolver o objeto faria toda entidade montada
   * reconciliar 60 vezes por segundo.
   */
  const travado = useSoftLockStore((s) => s.alvo?.gid === gid);
  /**
   * É o alvo SELECIONADO? (o do Tab, o do clique, o que o Ataque Básico bate)
   *
   * Seletor booleano, como o de cima: o alvo muda por clique e por Tab, não por
   * quadro, e devolver o gid faria toda entidade montada reconciliar a cada
   * troca de alvo em vez de só as duas envolvidas.
   */
  const alvo = useWorldStore((s) => s.target === gid);

  /**
   * Escolher a skill com o ponteiro JÁ sobre o monstro tem de apagar o realce.
   *
   * O `pointerover` não dispara de novo — o mouse não se mexeu —, então sem
   * isto o cursor de espada e o brilho vermelho ficariam acesos prometendo um
   * ataque que o clique não vai mais fazer.
   */
  useEffect(() => {
    if (!mirandoChao || !sobre.current) return;
    sobre.current = false;
    setRealce(false);
    useCursorStore.getState().pedir("attack", false);
  }, [mirandoChao]);

  // Um mob que MORRE com o ponteiro em cima nunca dispara `pointerout`: ele
  // some da cena e o cursor de ataque ficaria preso na tela para sempre.
  useEffect(
    () => () => {
      if (sobre.current) useCursorStore.getState().pedir("attack", false);
    },
    [],
  );

  useFrame((estado) => {
    const e = useWorldStore.getState().entities[gid];
    const g = group.current;
    if (!e || !g) return;

    const now = performance.now();
    const cell = interpolatedCell(e, now);
    const world = cellToWorld(map, mapping, cell.x, cell.y);
    const prev = g.position;

    /**
     * Monstro é desenhado da NÉVOA para dentro — a mesma regra do chão e dos
     * props (`play/viewRadius`).
     *
     * Quem decide quais entidades EXISTEM é o servidor (`area_size`, em
     * `rathena-conf/battle_conf.txt`), e ele mede num QUADRADO de células: com
     * 60 células o canto da diagonal chega a 170 unidades, bem além das 120 em
     * que a névoa já fecha. Aqui o corte é radial e usa a distância até a
     * CÂMERA, que é exatamente a conta que a névoa faz por fragmento — além
     * dela o bicho seria pintado 100% da cor da névoa.
     *
     * `visible = false` em vez de desmontar: desmontar devolveria o custo de
     * criar modelo, plaquinha e barra toda vez que ele cruza a fronteira, e o
     * raycaster pula objeto invisível de graça (clicar no que não se vê não é
     * para funcionar mesmo).
     */
    const cam = estado.camera.position;
    const dx = world.x - cam.x;
    const dz = world.z - cam.z;
    const visivel = dx * dx + dz * dz <= fogFar * fogFar;
    if (g.visible !== visivel) g.visible = visivel;
    // o mixer de animação lê isto no quadro seguinte: o three pula sozinho o
    // desenho e a sombra do que está invisível, mas o mixer é nosso
    aVista.current = visivel;
    if (!visivel) return;

    // Vira para onde está andando. Usa o deslocamento real do frame em vez do
    // `dir` do pacote: o rAthena só manda direção em alguns pacotes, e o
    // movimento contínuo ficaria de costas. A rotação é do MODELO, não do grupo
    // raiz — a plaquinha pendurada no raiz giraria junto com o bicho.
    if (cell.moving && model.current) {
      const dx = world.x - prev.x;
      const dz = world.z - prev.z;
      if (dx * dx + dz * dz > 1e-6) {
        model.current.rotation.y = Math.atan2(dx, dz);
      }
    }

    g.position.set(world.x, world.y, world.z);

    /**
     * Onde CADA entidade foi parar no mundo — a resposta para "o servidor mandou
     * o mob mas não aparece na tela".
     *
     * Uma vez a cada `DBG_INTERVALO_MS`, não por quadro. Escrito por quadro,
     * este bloco montava um objeto, três arrays e SEIS `toFixed` (que alocam
     * string e são reconvertidas com `+`) por entidade — com 25 mobs a 60 fps,
     * ~9.000 strings por segundo para alimentar um objeto de depuração que
     * ninguém lê 60 vezes por segundo. Duas leituras por segundo respondem a
     * mesma pergunta.
     */
    if (import.meta.env.DEV && now - ultimoDbg.current > DBG_INTERVALO_MS) {
      ultimoDbg.current = now;
      const dbg = (window as unknown as { __netEntities?: Record<number, unknown> });
      dbg.__netEntities ??= {};
      dbg.__netEntities[gid] = {
        tipo: e.kind,
        job: e.job,
        celula: [+cell.x.toFixed(1), +cell.y.toFixed(1)],
        mundo: [+world.x.toFixed(1), +world.y.toFixed(1), +world.z.toFixed(1)],
        modelo: modelInfo.character,
      };
    }

    /**
     * ANIMAÇÃO DE COMBATE — mesma regra do `NetPlayer`: o pulso (`net/combatAnim`)
     * é o mesmo dado que já faz o dano piscar, e enquanto ele toca a locomoção
     * não interrompe.
     */
    const pulso = pulsoDe(gid);
    if (pulso && pulso.em > ultimoPulsoVisto.current) {
      ultimoPulsoVisto.current = pulso.em;
      if (pulso.tipo === "attack") {
        ocupadoAte.current = now + playOnce("attack") * 1000;
      } else if (pulso.tipo === "castStart") {
        play("cast");
        ocupadoAte.current = now + Math.max(150, pulso.duracaoMs ?? 0);
      } else {
        ocupadoAte.current = now + playOnce("castRelease") * 1000;
      }
    }
    const emCombate = now < ocupadoAte.current;
    const saiuDoCombate = emCombateAntes.current && !emCombate;
    emCombateAntes.current = emCombate;
    if (!emCombate && (cell.moving !== wasMoving.current || saiuDoCombate)) {
      wasMoving.current = cell.moving;
      play(cell.moving ? "walk" : "idle");
    }
  });

  if (!entity) return null;

  // Altura aproximada do boneco no mundo (modelo KayKit ~1.8 em escala 1).
  const height = charScale * modelInfo.scale * 1.8;

  return (
    <group
      ref={group}
      /**
       * Cursor de ataque só sobre MONSTRO.
       *
       * NPC abre diálogo, não briga — e a arte é uma espada. Os handlers ficam
       * no grupo, então valem para o cilindro de clique junto (ele é invisível
       * pelo material, não por `visible`, justamente para continuar recebendo
       * raio).
       */
      onPointerOver={(e) => {
        if (entity?.kind !== "mob" || sobre.current) return;
        // mirando uma skill de chão, o clique não ataca — e o cursor de espada
        // com o realce vermelho prometeriam o contrário
        if (mirandoChao) return;
        e.stopPropagation();
        sobre.current = true;
        setRealce(true);
        useCursorStore.getState().pedir("attack", true);
      }}
      onPointerOut={() => {
        if (!sobre.current) return;
        sobre.current = false;
        setRealce(false);
        useCursorStore.getState().pedir("attack", false);
      }}
      onClick={(e) => {
        const aiming = useAimStore.getState().skill;

        /**
         * Com uma skill de CHÃO mirando, o monstro não recebe o clique.
         *
         * O clique escolhe ONDE a magia cai, e o alvo é a célula — não a
         * criatura. Deixar o `stopPropagation` acontecer aqui fazia o clique
         * morrer na entidade e nunca chegar ao chão, então mirar em cima de um
         * mob (o caso normal de uma área) ou não fazia nada, ou virava ataque.
         *
         * Sem `stopPropagation` e sem `setTarget`: o R3F segue entregando o
         * evento ao que está atrás, que é o plano do `GroundInteract`, e é ele
         * quem manda o `skill:use-ground` na célula certa.
         */
        if (cliqueVaiParaOChao(aiming)) return;

        /**
         * Montanha/prop no meio: o clique não é PARA esta entidade.
         *
         * A hitbox é um cilindro sem relação nenhuma com o que está desenhado
         * na frente dela — sem isto, um monstro escondido atrás de uma
         * montanha continuava clicável porque o R3F só testa objeto com
         * handler, e o relevo não tem nenhum. Sem `stopPropagation`: o clique
         * segue para o que estiver de fato na frente (o chão, via
         * `GroundInteract`), como se este mob nem estivesse ali.
         */
        if (entity.kind === "mob" && obstaculos.current.length > 0 && group.current) {
          const alvoVisada = group.current.position.clone();
          alvoVisada.y += (height * HITBOX_ALTURA) / 2;
          if (!temLinhaDeVisada(e.camera.position, alvoVisada, obstaculos.current)) return;
        }

        e.stopPropagation();
        useWorldStore.getState().setTarget(gid);

        // Mira de skill de ALVO pendente: este clique escolhe EM QUEM, e não
        // vira ataque normal — no RO o cursor de skill substitui o de ataque.
        // `castarEmAlvo` decide sozinha se já dá para lançar ou se precisa
        // andar até o alcance primeiro (mesma regra do ataque básico).
        if (aiming && aiming.mode === "entity") {
          castarEmAlvo(aiming.id, aiming.level, aiming.name, gid);
          useAimStore.getState().cancel();
          return;
        }

        // Alvo e ataque são pedido, não decisão: quem resolve acerto, dano e
        // morte é o servidor (CZ.REQUEST_ACT → ZC.NOTIFY_ACT).
        if (entity.kind === "mob") {
          // a CÉLULA sai do store no instante do clique, não da fatia de render:
          // posição é movimento, e movimento não passa por render (ver acima).
          // A sequência inteira mora em `net/acoes` — clicar EM CIMA do mob e
          // clicar PERTO dele (assistência de mira) têm de fazer o mesmo.
          const atual = useWorldStore.getState().entities[gid];
          if (!atual) return;
          atacar(gid, atual.x, atual.y);
        } else if (entity.kind === "npc") {
          // clicar no NPC começa o script DELE, no servidor; o diálogo que
          // aparece é o que ele mandar (hud/NpcDialog)
          gateway().emit("npc:talk", { gid });
        }
      }}
    >
      {/* Alvo de clique: os ossos do modelo são finos e o clique quase sempre
          passava entre os braços. Um cilindro em volta dele é o que o RO
          efetivamente oferece como área clicável.
          NÃO usar `visible={false}`: o raycaster do three PULA objeto invisível
          (Raycaster.intersectObject sai cedo em `object.visible === false`), e
          era por isso que clicar no mob não fazia nada. Some pelo material —
          sem escrever cor nem profundidade — e continua sendo raycastável. */}
      {/* geometria e material de MÓDULO: o cilindro é unitário e o tamanho vai
          no `scale`, então todas as entidades dividem os dois em vez de alocar
          um par por mob que entra no alcance (ver `net/recursosCompartilhados`) */}
      <mesh
        position={[0, (height * HITBOX_ALTURA) / 2, 0]}
        scale={[cellSize * HITBOX_RAIO * 2, height * HITBOX_ALTURA, cellSize * HITBOX_RAIO * 2]}
        geometry={GEO_CILINDRO}
        material={MATERIAL_INVISIVEL}
      />

      {/**
       * Brilho vermelho com o ponteiro EM CIMA ou com a trava do soft lock
       * apontando para cá.
       *
       * São as duas maneiras de o clique cair neste mob, e o realce tem de
       * cobrir as duas: acender só no `pointerover` deixava de fora justamente o
       * caso que a assistência existe para resolver — o ponteiro passando ao
       * LADO dele. A trava acende mais fraco, porque ali o jogador ainda não
       * está apontando: é um "seria este", não um "é este".
       */}
      {/**
       * O chão sob o mob diz TRÊS coisas, e elas se somam.
       *
       * `realce` — o ponteiro está em cima. `travado` — a assistência de mira
       * escolheria este. `alvo` — é o alvo SELECIONADO, o que o Tab cicla e o
       * que o Ataque Básico persegue; esse ganha o ARO, uma circunferência
       * fechada em volta do bicho, porque seleção é um estado que dura e precisa
       * ser legível de relance no meio de um bando.
       *
       * O brilho subiu (0,46 → 0,62 na trava, 0,55 → 0,78 no hover): sobre grama
       * clara e com o personagem em movimento, o que havia antes se perdia no
       * chão — e ele é o único retorno de "é neste que vou bater".
       */}
      <GlowChao
        cor={GLOW_INIMIGO}
        raio={cellSize * HITBOX_RAIO * (alvo ? 1.45 : 1.25)}
        aceso={realce || travado || alvo}
        forca={realce ? 0.78 : travado ? 0.62 : alvo ? 0.5 : 0}
        aro={alvo ? 0.95 : 0}
        terrain={terrain}
      />

      <group ref={model} scale={charScale * modelInfo.scale}>
        <primitive object={scene} />
      </group>

      {entity.name && (
        <EntityLabel
          name={entity.name}
          level={entity.level}
          hp={entity.hp}
          maxHp={entity.maxHp}
          height={height}
          cellSize={cellSize}
          targeted={targeted}
        />
      )}
    </group>
  );
}

/** Todas as entidades do mapa, menos o próprio personagem. */
export function NetEntities({
  map,
  mapping,
  charScale,
  animationSpeed,
  cellSize,
  fogFar,
  terrain,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  charScale: number;
  animationSpeed: number;
  cellSize: number;
  /** onde a névoa fecha; entidade além disso não é desenhada */
  fogFar: number;
  /** para o `GlowChao` de cada mob inclinar pelo relevo sob ele */
  terrain?: TerrainQuery;
}) {
  const selfGid = useWorldStore((s) => s.selfGid);
  /**
   * Só o conjunto de gids re-renderiza a lista; posição muda em `useFrame`.
   *
   * A lista vem PRONTA do store (`gids`, atualizada só em spawn/vanish). Antes
   * ela era derivada com `Object.keys(s.entities).join(",")`, e o zustand roda o
   * seletor de todo assinante em CADA `set` — ou seja, cada pacote de movimento
   * pagava uma varredura O(n) e uma string nova para concluir que nada tinha
   * mudado. Agora a comparação é de referência.
   */
  const gids = useWorldStore((s) => s.gids);

  /**
   * O grupo tem NOME porque o flight recorder conta objetos renderizáveis POR
   * CATEGORIA, e ele classifica pelo ancestral nomeado mais próximo
   * (`core/diagnostics/cenaProbe`). Sem o nome, mob e NPC cairiam em "outros" e
   * o retrato de um mundo vazio não diria O QUE sumiu.
   *
   * O grupo é inerte: transform identidade, nenhuma prop de render. Ele só
   * existe como rótulo.
   */
  return (
    <group name="net-entidades">
      {gids
        .filter((gid) => gid !== selfGid)
        .map((gid) => (
          <NetEntityView
            key={gid}
            gid={gid}
            map={map}
            mapping={mapping}
            charScale={charScale}
            animationSpeed={animationSpeed}
            cellSize={cellSize}
            fogFar={fogFar}
            terrain={terrain}
          />
        ))}
    </group>
  );
}
