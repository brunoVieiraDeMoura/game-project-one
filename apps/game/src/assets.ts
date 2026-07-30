import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

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
export function useCharacter(url: string, animationSpeed = 1): CharacterHandle {
  const gltf = useGLTF(url);
  const clips = useSharedClips();
  const animSpeed = useRef(animationSpeed);
  animSpeed.current = animationSpeed;

  const scene = useMemo(() => {
    // SkeletonUtils.clone preserva o vínculo bone↔skinnedmesh (Object3D.clone não —
    // o mesh clonado ficaria apontando pros bones do original → T-pose)
    return cloneSkinned(gltf.scene) as THREE.Group;
  }, [gltf.scene]);

  // mixer gerenciado na mão (não via drei useAnimations) — atualizado no useFrame
  // abaixo. actions criadas sobre os clips compartilhados; casam por nome de bone.
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const actions = useMemo(() => {
    const map: Record<string, THREE.AnimationAction> = {};
    for (const clip of clips) map[clip.name] = mixer.clipAction(clip);
    return map;
  }, [mixer, clips]);
  const current = useRef<string | null>(null);

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );
  useFrame((_, dt) => {
    mixer.timeScale = animSpeed.current; // "velocidade das animações" (editor do game)
    mixer.update(dt);
  });

  // toca idle assim que as actions existem — base garantida (o play() por-frame
  // do chamador cobre as transições idle↔walk↔attack por cima)
  useEffect(() => {
    const a = actions[CLIP.idle];
    if (a) {
      a.reset().fadeIn(0.2).play();
      current.current = CLIP.idle;
    }
  }, [actions]);

  // crossfade curto: transição idle↔walk↔run responde na hora (não "bloqueia")
  const FADE = 0.08;
  const play = (role: keyof typeof CLIP) => {
    const name = CLIP[role];
    if (current.current === name) return;
    const next = actions[name];
    if (!next) return;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    const prev = current.current ? actions[current.current] : null;
    next.reset().fadeIn(FADE).play();
    prev?.fadeOut(FADE);
    current.current = name;
  };

  // one-shot (jump/attack) a `speed`×: toca uma vez; o chamador retoma o loco
  const playOnce = (role: keyof typeof CLIP, speed = 1): number => {
    const name = CLIP[role];
    const a = actions[name];
    if (!a) return 0.5 / speed;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed; // mixer.timeScale (animSpeed) multiplica por cima
    const prev = current.current && current.current !== name ? actions[current.current] : null;
    a.reset().fadeIn(0.05).play();
    prev?.fadeOut(0.05);
    current.current = name;
    return a.getClip().duration / (speed * animSpeed.current);
  };

  return { scene, play, playOnce };
}
