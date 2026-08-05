import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { descartarPersonagem, fundirSkinned } from "./entities/personagemGltf";
import { somarCustoDeAnimacao, somarCustoDeModelo } from "./core/diagnostics/rendererProbe";
import { compartilharTexturas } from "./gltfTexturas";

/**
 * Registro central de assets 3D (KayKit). Personagens e skeletons são meshes
 * skinned com o rig compartilhado "Rig_Medium" (sem clips embutidos); as
 * animações vivem em glbs separados e casam por nome de bone, então um mesmo
 * conjunto de clips serve qualquer char/skeleton do kit. Servidos de
 * apps/game/public/assets (Vite serve public na raiz).
 */

const BASE = "/assets";

export const CHARACTER_URLS = {
  knight: `${BASE}/characters/Knight.glb`,
  skeleton_warrior: `${BASE}/characters/Skeleton_Warrior.glb`,
  skeleton_minion: `${BASE}/characters/Skeleton_Minion.glb`,
} as const;
export type CharacterKey = keyof typeof CHARACTER_URLS;

const ANIMATION_URLS = [
  `${BASE}/animations/Rig_Medium_MovementBasic.glb`,
  `${BASE}/animations/Rig_Medium_General.glb`,
];

/** clips que usamos, por papel semântico → nome do clip no kit */
export const CLIP = {
  idle: "Idle_A",
  walk: "Walking_C",
  run: "Running_A",
  jump: "Jump_Full_Short",
  attack: "Throw", // kit não traz golpe melee; Throw é o gesto mais próximo (placeholder)
  hit: "Hit_A",
  death: "Death_A",
} as const;

/** pré-carrega tudo (drei cacheia por url) */
export function preloadAssets() {
  for (const url of Object.values(CHARACTER_URLS)) useGLTF.preload(url);
  for (const url of ANIMATION_URLS) useGLTF.preload(url);
}

/**
 * Carrega os clips compartilhados do Rig_Medium (uma vez, cacheado) e devolve
 * um array de AnimationClip pronto pra useAnimations sobre qualquer char do kit.
 */
export function useSharedClips(): THREE.AnimationClip[] {
  const basic = useGLTF(ANIMATION_URLS[0]!);
  const general = useGLTF(ANIMATION_URLS[1]!);
  return useMemo(() => [...basic.animations, ...general.animations], [basic, general]);
}

export interface CharacterHandle {
  /** grupo raiz a ser inserido na cena (contém o mesh clonado) */
  scene: THREE.Group;
  /** toca um clip em loop por papel, com crossfade (idle/walk/run) */
  play: (role: keyof typeof CLIP) => void;
  /** toca um clip uma vez (jump/attack) a `speed`×; devolve a duração real (s) */
  playOnce: (role: keyof typeof CLIP, speed?: number) => number;
}

/**
 * Instancia um personagem clonável (SkeletonUtils) com os clips compartilhados
 * ligados. Clonar é obrigatório pra ter vários do mesmo glb sem compartilhar
 * skeleton. Retorna ref-based (nada de setState por frame).
 */
export function useCharacter(
  url: string,
  animationSpeed = 1,
  /**
   * Enquanto isto for `false`, o mixer NÃO avança.
   *
   * Entidade além da névoa é `visible = false` (ver `net/NetEntity`), e o three
   * pula de graça o que está invisível no desenho e no passe de sombra — mas o
   * `AnimationMixer` é nosso e continuava correndo. Com `area_size: 60` o
   * servidor anuncia um quadrado de 121×121 células, várias vezes mais fundo que
   * o raio da névoa: dezenas de esqueletos eram animados por quadro para
   * ninguém ver.
   *
   * É um REF, não estado: quem sabe se a entidade está à vista é o `useFrame`
   * dela, e passar isso por `setState` a 60 Hz seria o erro que este projeto
   * evita em todo lugar. Como o hook do mixer é registrado ANTES do da entidade,
   * ele lê o valor do quadro anterior — um quadro de atraso numa animação não
   * tem consequência nenhuma.
   *
   * Sem o argumento, anima sempre (o próprio personagem, o retrato do HUD).
   */
  ativoRef?: React.RefObject<boolean> | React.MutableRefObject<boolean>,
): CharacterHandle {
  const gltf = useGLTF(url);
  const clips = useSharedClips();
  const animSpeed = useRef(animationSpeed);
  animSpeed.current = animationSpeed;

  const scene = useMemo(() => {
    /**
     * Funde as nove malhas skinadas ANTES de clonar (uma vez por url, ver
     * `entities/personagemGltf`). Cada malha clonada carrega um `Skeleton`
     * próprio com um `boneTexture` — nove por entidade em draw call, em upload
     * de textura por quadro e em memória vazada. Fundindo, sobra uma (duas no
     * Skeleton_Warrior, que tem um material só para os olhos).
     */
    /**
     * CRONOMETRADO: é um dos cinco suspeitos do quadro longo.
     *
     * O `.glb` já está em cache (`preloadAssets`), então aqui não há download —
     * o que há é fundir nove malhas skinadas e clonar o esqueleto, trabalho de
     * CPU que acontece toda vez que um retrato do HUD MONTA. Sem medi-lo, ele
     * ficaria indistinguível da criação do contexto WebGL, que acontece no
     * mesmo instante.
     */
    const t0 = performance.now();
    // mesma cirurgia na cena do cache, e pela mesma razão que a fusão: os três
    // personagens do kit compartilham o atlas do KayKit, e cada `.glb` traz a
    // sua própria cópia dele (ver `gltfTexturas`)
    compartilharTexturas(gltf as never);
    fundirSkinned(gltf.scene);
    // SkeletonUtils.clone preserva o vínculo bone↔skinnedmesh (Object3D.clone não —
    // o mesh clonado ficaria apontando pros bones do original → T-pose)
    const clone = cloneSkinned(gltf.scene) as THREE.Group;
    if (import.meta.env.DEV) somarCustoDeModelo(performance.now() - t0);
    return clone;
  }, [gltf.scene]);

  // mixer gerenciado na mão (não via drei useAnimations) — atualizado no useFrame
  // abaixo. actions criadas sobre os clips compartilhados; casam por nome de bone.
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  /**
   * As actions são criadas SOB DEMANDA, não todas de uma vez.
   *
   * Os dois glb de animação compartilhados somam 26 clips (11 de movimento + 15
   * gerais), e `mixer.clipAction(clip)` não é grátis: ele monta as ligações
   * osso↔faixa daquele clip e registra a action no mixer. Um mob usa `idle` e
   * `walk`; o retrato do HUD usa só `idle`. Criar as 26 por entidade era
   * trabalho jogado fora vezes o número de bichos na tela — e com `area_size:
   * 60` são dezenas nascendo e sumindo o tempo todo.
   *
   * O `Map` vive num ref chaveado pelo mixer: trocar de modelo troca o mixer e
   * o cache junto, sem precisar de invalidação escrita à mão.
   */
  const porNome = useMemo(() => new Map(clips.map((c) => [c.name, c])), [clips]);
  const cacheDeActions = useRef<{ mixer: THREE.AnimationMixer; acoes: Map<string, THREE.AnimationAction> } | null>(
    null,
  );
  const pegarAction = (nome: string): THREE.AnimationAction | undefined => {
    let cache = cacheDeActions.current;
    if (!cache || cache.mixer !== mixer) {
      cache = { mixer, acoes: new Map() };
      cacheDeActions.current = cache;
    }
    const pronta = cache.acoes.get(nome);
    if (pronta) return pronta;
    const clip = porNome.get(nome);
    if (!clip) return undefined;
    const nova = mixer.clipAction(clip);
    cache.acoes.set(nome, nova);
    return nova;
  };
  const current = useRef<string | null>(null);

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  /**
   * Devolve o que este clone alocou.
   *
   * Cada SkinnedMesh clonado tem um `Skeleton` PRÓPRIO (o `SkeletonUtils.clone`
   * faz `skeleton.clone()` por malha) com um `boneTexture` que só
   * `Skeleton.dispose()` libera. Sem isto, cada mob que nascia e sumia deixava
   * suas texturas para trás — com `area_size: 60` e 271 mobs no mapa, o F9 media
   * 4.042 texturas vivas contra 5 referenciadas pela cena.
   *
   * Geometria e material NÃO são descartados: vêm do cache do `useGLTF` e são
   * compartilhados com todos os outros personagens na tela.
   *
   * ## Por que NÃO tem `mixer.uncacheRoot(scene)` aqui
   *
   * Porque quebra o remonte, e o StrictMode remonta todo efeito no dev. O
   * `scene`, o `mixer` e as `actions` vêm de `useMemo` com dependência
   * `[gltf.scene]`, que NÃO muda entre a desmontagem simulada e a remontagem —
   * então as actions sobrevivem à limpeza. `uncacheRoot` apaga as ligações
   * daquele root do mixer e deixa as actions órfãs; o efeito seguinte chama
   * `a.reset().fadeIn().play()` sobre uma delas e o three estoura em
   * `_lendBinding` ("Cannot set properties of undefined (setting
   * '_cacheIndex')"), derrubando o `<Canvas>` inteiro.
   *
   * Ele também não é necessário: o mixer é DESTE clone e vira lixo junto com o
   * componente. `stopAllAction` basta para parar o que estava tocando.
   *
   * `Skeleton.dispose()` sobrevive ao mesmo remonte porque é reversível — ele só
   * zera o `boneTexture`, e o `WebGLRenderer` o reconstrói na primeira vez que
   * for desenhar de novo. E é idempotente, então descartar duas vezes não custa.
   */
  useEffect(
    () => () => {
      mixer.stopAllAction();
      descartarPersonagem(scene);
    },
    [mixer, scene],
  );
  useFrame((_, dt) => {
    // fora de vista, não anima (ver `ativoRef`)
    if (ativoRef && ativoRef.current === false) return;
    mixer.timeScale = animSpeed.current; // "velocidade das animações" (editor do game)
    /**
     * CRONOMETRADO por entidade e SOMADO no quadro (`animacaoMs`).
     *
     * É um dos subsistemas que a auditoria pede isolado, e ele não aparece em
     * nenhum outro número: fica FORA de `gl.render`, então não entra no
     * `renderMs`, e é espalhado por dezenas de `useFrame` — um por entidade
     * viva. Só a soma responde "a animação está limitando o quadro?".
     */
    if (import.meta.env.DEV) {
      const t0 = performance.now();
      mixer.update(dt);
      somarCustoDeAnimacao(performance.now() - t0);
    } else {
      mixer.update(dt);
    }
  });

  /**
   * Toca idle assim que as actions existem — base garantida (o `play()`
   * por-quadro do chamador cobre as transições idle↔walk↔attack por cima).
   *
   * **Sem `fadeIn`, e com um `update(0)` na sequência.** Era daqui que saía o
   * T-POSE ao abrir o Alt+Q: `fadeIn(0.2)` começa a action com peso ZERO, e
   * peso zero significa que o esqueleto fica na BIND POSE — o boneco de braços
   * abertos do .glb. Por dois décimos de segundo o retrato mostrava exatamente
   * isso antes de a idle assumir.
   *
   * No mundo 3D quase não se via (a entidade nasce longe e em movimento); no
   * medalhão do HUD, que abre com o rosto em primeiro plano, era o primeiro
   * quadro inteiro. Pior no retrato: ele roda em `frameloop="demand"` a 24 Hz,
   * então "dois décimos" são cinco quadros parados na T-pose.
   *
   * Não há o que interpolar na PRIMEIRA animação — não existe pose anterior —,
   * então o fade só tinha o que estragar. O `update(0)` aplica a pose ao
   * esqueleto ali mesmo, para o primeiro quadro DESENHADO já sair certo mesmo
   * que o `useFrame` ainda não tenha rodado.
   */
  useEffect(() => {
    const a = pegarAction(CLIP.idle);
    if (a) {
      a.reset().play();
      current.current = CLIP.idle;
      mixer.update(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, porNome]);

  // crossfade curto: transição idle↔walk↔run responde na hora (não "bloqueia")
  const FADE = 0.08;
  const play = (role: keyof typeof CLIP) => {
    const name = CLIP[role];
    if (current.current === name) return;
    const next = pegarAction(name);
    if (!next) return;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    const prev = current.current ? pegarAction(current.current) : null;
    next.reset().fadeIn(FADE).play();
    prev?.fadeOut(FADE);
    current.current = name;
  };

  // one-shot (jump/attack) a `speed`×: toca uma vez; o chamador retoma o loco
  const playOnce = (role: keyof typeof CLIP, speed = 1): number => {
    const name = CLIP[role];
    const a = pegarAction(name);
    if (!a) return 0.5 / speed;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed; // mixer.timeScale (animSpeed) multiplica por cima
    const prev = current.current && current.current !== name ? pegarAction(current.current) : null;
    a.reset().fadeIn(0.05).play();
    prev?.fadeOut(0.05);
    current.current = name;
    return a.getClip().duration / (speed * animSpeed.current);
  };

  return { scene, play, playOnce };
}
