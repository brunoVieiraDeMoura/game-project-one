import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CHARACTER_URLS, useCharacter, type CharacterKey, type WeaponMount } from "../assets";
import { usePlayerStore } from "../net/playerStore";
import { classModelFor } from "../entities/classModels";
import { EquippedWeapons } from "../entities/EquippedWeapons";
import { SondaDeCanvas, SondaDeMontagem, SondaDeSuspense } from "../core/diagnostics/SondaDeCanvas";

/**
 * Retrato do personagem no buraco do aro da placa (change.txt: "se tiver como
 * colocar o rosto do char no local do avatar").
 *
 * É o MESMO glb que anda no mundo, num canvas próprio de ~100 px enquadrado na
 * cabeça — nada de textura de rosto desenhada à mão, que sairia do ar assim que
 * o modelo por classe existir. O `idle` já toca sozinho (assets.ts), então o
 * busto respira.
 *
 * O enquadramento sai do OSSO `head` do Rig_Medium (os três chars do kit têm
 * ele em y=1.241) e não de uma fração da caixa do modelo. A caixa mente: ela é
 * a geometria em BIND POSE, e no Knight ela vai até y=2,543 — a crista do elmo
 * —, enquanto o pescoço está em 1,241. Mirar "14% abaixo do topo da caixa"
 * apontava para 2,19, ou seja, para o alto do capacete: era isso o retrato que
 * mostrava só o topo da cabeça.
 */
const FOV = 24; // lente de retrato: distorce menos o rosto que os 50° da cena
/** quanto de ombro entra abaixo do pescoço, em alturas-de-cabeça */
const OMBRO = 0.3;

/**
 * A quantos quadros por segundo o retrato desenha.
 *
 * Este componente é um CONTEXTO WebGL À PARTE, com um personagem skinado
 * inteiro e um `AnimationMixer` próprio dentro. Ele é montado sempre pela placa
 * do personagem, de novo pela placa do ALVO quando há algo mirado, e de novo
 * pela janela de Status quando ela está aberta — ou seja, até três cenas 3D
 * completas rodando a 60 Hz ao lado do jogo, para animar um `idle` num círculo
 * de ~94 px.
 *
 * 24 Hz é o bastante para o busto respirar e para o arrasto da janela de Status
 * acompanhar o mouse, e corta ~60% dos quadros desenhados por retrato.
 */
const RETRATO_FPS = 24;

/**
 * Libera o contexto WebGL do retrato NA HORA do desmonte, sem esperar o R3F.
 *
 * `@react-three/fiber` já chama `gl.forceContextLoss()` sozinho no desmonte
 * (`unmountComponentAtNode`, dist/events-*.js) — mas dentro de um
 * `setTimeout(..., 500)`. Um retrato isolado sumindo e voltando cabe fácil
 * nessa janela. O char-select não: ele é uma TELA INTEIRA de retratos (um por
 * personagem da lista) que desmonta de uma vez quando o jogador clica para
 * entrar, exatamente no instante em que o `PlayView` monta os PRÓPRIOS
 * contextos (jogo + placa do jogador). Por 500 ms os dois lados ficam vivos
 * ao mesmo tempo — é essa pilha, não um perdido isolado, que estoura o teto
 * de ~16 do Chrome e derruba o contexto do JOGO (mesmo mecanismo já
 * documentado em `core/diagnostics/rendererProbe.ts`, achado com dado real:
 * "Context Lost × 19"). Forçar aqui, síncrono, tira o retrato da soma antes
 * do `PlayView` sequer pedir o dele.
 */
function LiberarContextoAoDesmontar() {
  const gl = useThree((s) => s.gl);
  useEffect(() => () => gl.forceContextLoss(), [gl]);
  return null;
}

/**
 * Pede um quadro em intervalo fixo — o motor do `frameloop="demand"`.
 *
 * Com `demand`, o R3F só desenha quando alguém chama `invalidate()`. Sem isto o
 * retrato ficaria congelado no primeiro quadro: quem o anima é o `useFrame` do
 * mixer, e `useFrame` só roda em quadro que existe.
 */
function Pulso() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / RETRATO_FPS);
    return () => clearInterval(id);
  }, [invalidate]);
  return null;
}

/**
 * Bbox do CORPO — ignora arma (`o.userData.arma`, marcada em
 * `entities/EquippedWeapons`).
 *
 * `Box3.setFromObject(scene)` mediria a arma junto, e o grip dela não é a
 * origem do mesh como em espada/adaga/cajado: o arco tem a origem no CENTRO
 * do limbo, então metade do modelo cai abaixo da mão. Incluído na medida,
 * aquele pedaço abaixo do pé virava "chão" mais baixo que o pé de verdade, e
 * o enquadramento "inteiro" recentrava a cena inteira nele — o personagem
 * saía do lugar (visto no char-select: "arco no chão, personagem voado").
 * A arma continua desenhada normalmente; só não conta pro enquadramento.
 */
function medirCorpo(scene: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || o.userData.arma) return;
    box.union(new THREE.Box3().setFromObject(mesh));
  });
  return box;
}

function Bust({
  url,
  weapons,
  inteiro,
  giro,
}: {
  url: string;
  weapons?: readonly WeaponMount[];
  inteiro?: boolean;
  /** angulo em radianos que o arrasto acumulou; mexido por ref, nunca por state */
  giro?: React.MutableRefObject<number>;
}) {
  const { scene } = useCharacter(url, 1);
  const camera = useThree((s) => s.camera);

  useLayoutEffect(() => {
    scene.updateWorldMatrix(true, true);
    const box = medirCorpo(scene);
    if (!Number.isFinite(box.max.y) || box.max.y <= box.min.y) return;

    // pescoço: origem do osso da cabeça. Sem o osso (glb de fora do kit),
    // aproxima por 2/3 da altura, que é onde ele cai nos três do kit.
    const osso = scene.getObjectByName("head");
    const pescoco = osso
      ? osso.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.66, 0);

    const cabeca = box.max.y - pescoco.y; // topo da cabeça acima do pescoço
    // corpo inteiro: enquadra dos pés ao topo. Busto: do ombro para cima.
    const base = inteiro ? box.min.y : pescoco.y - cabeca * OMBRO;
    const alvoY = (base + box.max.y) / 2;
    const enquadra = (box.max.y - base) * 1.08; // folga nas bordas do medalhão
    const dist = enquadra / (2 * Math.tan((FOV * Math.PI) / 360));
    const az = Math.PI * 0.13; // 3/4 de leve, como a silhueta da referência

    camera.position.set(
      pescoco.x + Math.sin(az) * dist,
      alvoY,
      pescoco.z + Math.cos(az) * dist,
    );
    camera.lookAt(pescoco.x, alvoY, pescoco.z);
    camera.updateProjectionMatrix();
  }, [scene, camera, inteiro]);

  // O giro do arrasto e aplicado por QUADRO, mutando a rotacao do grupo: passar
  // o angulo por `setState` repintaria o HUD a cada pixel de mouse.
  useFrame(() => {
    if (giro) scene.rotation.y = giro.current;
  });

  return (
    <>
      <primitive object={scene} />
      {weapons && weapons.length > 0 && <EquippedWeapons scene={scene} weapons={weapons} />}
    </>
  );
}

export function CharacterPortrait({
  // sem `characterKey`, o retrato é do PRÓPRIO jogador (`dono="jogador"`) e
  // busca personagem+arma da classe real (`character/characterStore`, ver
  // `entities/classModels`) — "alvo" e "status" passam a deles explicitamente
  // (e a arma junto, em `weapons`, senão o busto sai desarmado).
  characterKey,
  weapons,
  inteiro,
  fundo,
  giravel,
  giroRef,
  dono = "?",
}: {
  /**
   * QUEM montou este retrato — "jogador", "alvo", "status", "char-select".
   *
   * São até três contextos WebGL vivos ao mesmo tempo e todos se chamavam
   * "retrato" no laudo, então "qual deles nasceu" não tinha resposta. Só
   * diagnóstico: nada aqui muda o que é desenhado.
   */
  dono?: string;
  characterKey?: CharacterKey;
  /** arma(s) do busto; sem isto (e sem `characterKey`) puxa da classe real */
  weapons?: readonly WeaponMount[];
  /** enquadra o corpo todo (janela de status) em vez do busto (medalhão) */
  inteiro?: boolean;
  /** fundo por trás do modelo; `false` deixa transparente (cena pintada atrás) */
  fundo?: false;
  /** arrastar com o mouse gira o personagem no PRÓPRIO eixo (só em Y) */
  giravel?: boolean;
  /**
   * Ângulo controlado de FORA (ui-change.txt: as duas setas do char-select
   * giram o personagem sem arrastar). Quando passado, o componente muta ESTE
   * ref em vez de um interno — quem chamou pode incrementar `giroRef.current`
   * direto num `onClick`, e o `useFrame` do busto (que já lê `giro.current` a
   * cada pulso) pega a mudança sozinho, sem precisar de `setState` nenhum.
   */
  giroRef?: React.MutableRefObject<number>;
}) {
  const giroInterno = useRef(0);
  const giro = giroRef ?? giroInterno;
  const arrasto = useRef<number | null>(null);

  // `stats.class` (`net/playerStore`, semeado no char:select) — NÃO
  // `character/characterStore`, que só serve o modo local/demo e nunca é
  // preenchido numa sessão de verdade (era por isso que o retrato do
  // jogador — "jogador"/"status" — caía sempre no fallback Barbarian).
  const jobId = usePlayerStore((s) => s.stats.class);
  const classModel = classModelFor(jobId);
  const resolvedCharacterKey = characterKey ?? classModel.character;
  const resolvedWeapons = weapons ?? (characterKey ? [] : classModel.weapons);

  // Só o eixo Y: girar em X deitaria o personagem, e o enquadramento (feito a
  // partir do osso da cabeça) deixaria de valer.
  const pegar = (e: React.PointerEvent) => {
    if (!giravel) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    arrasto.current = e.clientX;
  };
  const mover = (e: React.PointerEvent) => {
    if (arrasto.current === null) return;
    // meia volta a cada ~180 px de arrasto: rápido o bastante para ver as
    // costas sem exigir travessia da tela
    giro.current += ((e.clientX - arrasto.current) / 180) * Math.PI;
    arrasto.current = e.clientX;
  };
  const soltar = () => {
    arrasto.current = null;
  };

  return (
    <div
      onPointerDown={pegar}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: inteiro ? 0 : "50%",
        overflow: "hidden",
        // Fundo do medalhão: fica visível enquanto o glb carrega e por trás do
        // busto, para o buraco do aro nunca aparecer vazado. É PRETO com
        // opacidade — a versão amarronzada de antes competia com a madeira do
        // aro; o escuro translúcido deixa o mundo aparecer de leve e faz o
        // personagem destacar. Na janela de status quem faz esse papel é a cena
        // de floresta da arte, daí o `fundo={false}`.
        background:
          fundo === false
            ? undefined
            : "radial-gradient(circle at 50% 32%, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.72) 62%, rgba(0,0,0,0.85) 100%)",
        cursor: giravel ? "grab" : undefined,
        touchAction: giravel ? "none" : undefined,
      }}
    >
      {/* FORA do `<Canvas>`: marca o momento em que o React montou o
          componente, que é ANTES de o contexto WebGL existir. A distância entre
          este evento e o `contexto-criado` é o que separa "o React remontou" de
          "criar o contexto custou". */}
      {import.meta.env.DEV && (
        <SondaDeMontagem nome={`retrato:${dono}`} dados={{ characterKey: resolvedCharacterKey, inteiro: !!inteiro }} />
      )}
      <Canvas
        camera={{ fov: FOV, near: 0.01, far: 100 }}
        /**
         * Um retrato NÃO merece o orçamento de uma cena.
         *
         * `dpr` 1: o medalhão tem ~94 px de lado; a 1,5 seriam 2,25× de pixels
         * para desenhar a mesma cabeça. `antialias: false`: MSAA 4× num busto
         * desse tamanho custa e quase não se vê — a silhueta é escondida pelo
         * aro de madeira da placa, que é o recorte que o olho segue.
         * `frameloop="demand"` + `Pulso`: 24 Hz em vez de 60 (ver RETRATO_FPS).
         */
        dpr={1}
        gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
        frameloop="demand"
        style={{ position: "absolute", inset: 0 }}
      >
        <Pulso />
        <LiberarContextoAoDesmontar />
        {/* Um contexto WebGL à parte, e foi o vai-e-vem deles que estourou o
            teto do Chrome e derrubou o contexto do JOGO. A sonda os põe na
            coluna `contextosVivos` do flight recorder; ela não dispara captura
            (ver `SondaDeCanvas`). Um ponto só cobre os três usos: placa do
            personagem, placa do alvo e janela de Status. */}
        {import.meta.env.DEV && <SondaDeCanvas nome={`retrato:${dono}`} />}
        <ambientLight intensity={1.5} />
        <directionalLight position={[2, 3, 4]} intensity={2.2} />
        <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#9fb4d8" />
        {/* nomeado para o laudo distinguir ESTE boundary do da cena: o busto
            também carrega um .glb, e os dois suspendendo juntos seriam
            indistinguíveis com um sinal anônimo */}
        <Suspense fallback={import.meta.env.DEV ? <SondaDeSuspense nome="retrato" /> : null}>
          <Bust
            url={CHARACTER_URLS[resolvedCharacterKey]}
            weapons={resolvedWeapons}
            inteiro={inteiro}
            giro={giravel || giroRef ? giro : undefined}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
