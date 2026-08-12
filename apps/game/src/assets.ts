import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { descartarPersonagem, fundirSkinned } from "./entities/personagemGltf";
import { somarCustoDeAnimacao, somarCustoDeModelo } from "./core/diagnostics/rendererProbe";
import { registrarEvento } from "./core/diagnostics/flightRecorder";
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
  mage: `${BASE}/characters/Mage.glb`,
  rogue: `${BASE}/characters/Rogue.glb`,
  rogue_hooded: `${BASE}/characters/Rogue_Hooded.glb`,
  barbarian: `${BASE}/characters/Barbarian.glb`,
  skeleton_warrior: `${BASE}/characters/Skeleton_Warrior.glb`,
  skeleton_minion: `${BASE}/characters/Skeleton_Minion.glb`,
  /**
   * Personagem de arqueiro DEDICADO do kit (`assets-new/Characters/
   * Characters/gltf/Ranger.glb`) — mesmo rig `Rig_Medium`, 23 joints, mesmos
   * dois `handslot.l`/`handslot.r`, textura embutida no próprio .glb (igual
   * aos outros 7), conferido por inspeção binária direta do glTF antes de
   * copiar. Usado pela família `archer` em `entities/classModels` no lugar
   * do Rogue com arco rotacionado: tem malha própria de arqueiro (inclui
   * `Ranger_Quiver`, carcaz nas costas) em vez de reaproveitar o visual do
   * ladrão.
   */
  ranger: `${BASE}/characters/Ranger.glb`,
} as const;
export type CharacterKey = keyof typeof CHARACTER_URLS;

/**
 * Armas (KayKit `Characters/Assets`) presas no `handslot.l`/`handslot.r` do
 * personagem — ver `useEquippedWeapons` abaixo e `entities/classModels` para
 * quem usa qual.
 */
export const WEAPON_URLS = {
  sword_2handed: `${BASE}/weapons/sword_2handed.gltf`,
  dagger: `${BASE}/weapons/dagger.gltf`,
  staff: `${BASE}/weapons/staff.gltf`,
  /**
   * `arrow_bow.gltf` (usado antes) é só a FLECHA sozinha — sem arco nenhum,
   * daí o bug visto no char-select ("archer com uma flecha na mão"). Este é
   * o arco de verdade, com a corda (`Characters/Assets/gltf/bow_withString`).
   * Malha longa no eixo Z (limbo a limbo) — precisa do `rotation` em
   * `WeaponMount` pra ficar de pé como um arco (ver `classModels.archer`).
   */
  bow: `${BASE}/weapons/bow_withString.gltf`,
} as const;
export type WeaponKey = keyof typeof WEAPON_URLS;

/**
 * os dois nós vazios que todo char do Rig_Medium tem para pendurar arma.
 *
 * No .glb/.gltf de origem os nós se chamam `handslot.l`/`handslot.r` (com
 * ponto) — mas o `GLTFLoader` do three passa todo nome de nó por
 * `PropertyBinding.sanitizeNodeName` (o `.` é delimitador de path de
 * animação, ex. `"nome.position"`), que REMOVE o ponto. Em runtime o nome é
 * `handslotl`/`handslotr`; usar a forma com ponto aqui faria
 * `getObjectByName` nunca achar o osso (conferido com `__weaponDebug` no
 * `/class-preview`, todas as 20 tentativas voltavam `boneFound: false`).
 */
export type HandSlot = "handslotl" | "handslotr";
export interface WeaponMount {
  weapon: WeaponKey;
  slot: HandSlot;
  /**
   * Ajuste de pose (radianos, XYZ) aplicado ANTES de virar filho do
   * handslot. A convenção do kit é malha comprida no eixo Y com a origem no
   * punho (`sword_2handed`, `dagger`, `staff` — encaixam sem ajuste); o arco
   * (`bow_withString`) foge disso, comprido no eixo Z, e precisa girar 90° em
   * X pra ficar de pé (medido visualmente em `/class-preview`).
   */
  rotation?: readonly [number, number, number];
}

const ANIMATION_URLS = [
  `${BASE}/animations/Rig_Medium_MovementBasic.glb`,
  `${BASE}/animations/Rig_Medium_General.glb`,
  `${BASE}/animations/Rig_Medium_CombatMelee.glb`,
  `${BASE}/animations/Rig_Medium_CombatRanged.glb`,
];

/** papel semântico → nome do clip; todo `WeaponFamily` preenche as mesmas chaves */
interface ClipSet {
  idle: string;
  walk: string;
  run: string;
  jump: string;
  attack: string;
  /** conjuração/preparação — LOOP enquanto a barra de cast corre (ver `net/combatAnim`) */
  cast: string;
  /** a skill SAI — tocado uma vez quando a skill sai (`skill:cast`) */
  castRelease: string;
  hit: string;
  death: string;
}

/**
 * Um conjunto de clips por família de arma — a mesma `useCharacter` serve
 * Knight (espada 2M), Rogue_Hooded (adaga dupla), Mage (cajado), Rogue/Archer
 * (arco) e Barbarian (desarmado) trocando só qual clip cada papel toca.
 * `mage` é o default histórico (mob/NPC/skeleton continuam iguais).
 */
export type WeaponFamily = "swordsman" | "thief" | "mage" | "archer" | "other";

const COMUM = { idle: "Idle_A", walk: "Walking_C", run: "Running_A", jump: "Jump_Full_Short", hit: "Hit_A", death: "Death_A" };

const CLIP_SETS: Record<WeaponFamily, ClipSet> = {
  // default histórico — Melee_1H genérico + magia (mob/NPC/skeleton/player sem classe ainda)
  mage: { ...COMUM, attack: "Melee_1H_Attack_Slice_Horizontal", cast: "Ranged_Magic_Spellcasting", castRelease: "Ranged_Magic_Shoot" },
  swordsman: { ...COMUM, attack: "Melee_2H_Attack_Slice", cast: "Melee_2H_Idle", castRelease: "Melee_2H_Attack_Stab" },
  thief: { ...COMUM, attack: "Melee_Dualwield_Attack_Slice", cast: "Melee_Blocking", castRelease: "Melee_Dualwield_Attack_Stab" },
  archer: { ...COMUM, attack: "Ranged_Bow_Release", cast: "Ranged_Bow_Draw", castRelease: "Ranged_Bow_Release" },
  other: { ...COMUM, attack: "Melee_Unarmed_Attack_Punch_A", cast: "Melee_Unarmed_Idle", castRelease: "Melee_Unarmed_Attack_Kick" },
};

/** compat: quem só conhecia o CLIP fixo de antes (mago genérico) continua igual */
export const CLIP = CLIP_SETS.mage;

/** pré-carrega tudo (drei cacheia por url) */
export function preloadAssets() {
  for (const url of Object.values(CHARACTER_URLS)) useGLTF.preload(url);
  for (const url of Object.values(WEAPON_URLS)) useGLTF.preload(url);
  for (const url of ANIMATION_URLS) useGLTF.preload(url);
}

/**
 * Carrega os clips compartilhados do Rig_Medium (uma vez, cacheado) e devolve
 * um array de AnimationClip pronto pra useAnimations sobre qualquer char do kit.
 */
export function useSharedClips(): THREE.AnimationClip[] {
  const basic = useGLTF(ANIMATION_URLS[0]!);
  const general = useGLTF(ANIMATION_URLS[1]!);
  const melee = useGLTF(ANIMATION_URLS[2]!);
  const ranged = useGLTF(ANIMATION_URLS[3]!);
  return useMemo(
    () => [...basic.animations, ...general.animations, ...melee.animations, ...ranged.animations],
    [basic, general, melee, ranged],
  );
}

export type ClipRole = keyof ClipSet;

export interface CharacterHandle {
  /** grupo raiz a ser inserido na cena (contém o mesh clonado) */
  scene: THREE.Group;
  /** toca um clip em loop por papel, com crossfade (idle/walk/run) */
  play: (role: ClipRole) => void;
  /** toca um clip uma vez (jump/attack) a `speed`×; devolve a duração real (s) */
  playOnce: (role: ClipRole, speed?: number) => number;
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
  /** qual conjunto de clips (ataque/conjuração) — a arma da classe decide, ver `entities/classModels` */
  family: WeaponFamily = "mage",
): CharacterHandle {
  const gltf = useGLTF(url);
  const clips = useSharedClips();
  const animSpeed = useRef(animationSpeed);
  animSpeed.current = animationSpeed;
  const clipSet = CLIP_SETS[family];

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
    if (import.meta.env.DEV) {
      const ms = performance.now() - t0;
      somarCustoDeModelo(ms);
      // só acima do limiar (mesma régua do `medir()`, 15 ms): laço quente não
      // pode encher o anel de 512 eventos — a coluna `modeloMs` já soma TODO
      // clone, evento é só para o caro o bastante para valer investigar
      if (ms >= 15) registrarEvento("cena", "gltf:clone", { url, ms });
    }
    return clone;
  }, [gltf.scene]);

  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const cenaRaiz = useThree((s) => s.scene);
  /**
   * FASE E2 — compila o material da entidade ATRÁS do primeiro `draw`, não
   * durante ele.
   *
   * Causa comprovada (Classe 2, `voo-1786187479459.json`): dois quadros de
   * 287,9 e 308,8 ms com `render cpu` 274,4/302,9 ms — CPU dentro de
   * `gl.render`, não GPU — e `renderer/shader-compilado delta=1` no MESMO
   * instante. `play/PreCompilarProps` já paga isso para os PROPS do mapa
   * (uma instância de cada espécie, fora do frustum, na PRÉ-CARGA); ele não
   * cobre entidade nenhuma, porque entidade não existe na hora da
   * pré-carga — mob e jogador entram DEPOIS, em pleno combate, e é o
   * primeiro `draw` de cada um que paga o link do programa.
   *
   * Fica em `useCharacter`, não em `NetEntity`/`CharacterPortrait`
   * separadamente: os dois passam por aqui, então um ponto só cobre
   * personagem em mundo E retrato do HUD, cada um compilando no PRÓPRIO
   * contexto (`useThree` lê o `gl`/`scene`/`camera` do `<Canvas>` mais
   * próximo — o do jogo para `NetEntity`, o do retrato para
   * `CharacterPortrait`).
   *
   * `requestAnimationFrame`: no efeito o `<primitive object={scene}>` ainda
   * não commitou no grafo de cena three (mesmo motivo do
   * `PreCompilarProps`) — um quadro depois, está. `compileAsync` roda em
   * paralelo (`KHR_parallel_shader_compile` quando existe) e NUNCA bloqueia
   * o quadro que o disparou — é o oposto do stall medido. Sem `ref` de
   * "já compilado": a troca de `scene` (personagem virou outra espécie) tem
   * de compilar de NOVO, porque o material é outro; para a MESMA `scene` o
   * efeito só roda uma vez (dependência é a própria referência do clone).
   */
  useEffect(() => {
    let vivo = true;
    const t0 = performance.now();
    const id = requestAnimationFrame(() => {
      if (!vivo) return;
      const pronto = gl.compileAsync
        ? gl.compileAsync(scene, camera, cenaRaiz)
        : (gl.compile(scene, camera), Promise.resolve());
      void Promise.resolve(pronto).then(() => {
        if (!vivo || !import.meta.env.DEV) return;
        registrarEvento("cena", "shader:compile-entidade", {
          ms: Math.round(performance.now() - t0),
          programas: gl.info.programs?.length ?? 0,
        });
      });
    });
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [gl, camera, cenaRaiz, scene]);

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
   *
   * **E tem que ser `useLayoutEffect`, não `useEffect`.** O retrato do HUD
   * (Alt+A/Alt+Q) roda em `frameloop="demand"`: o R3F agenda o primeiro
   * quadro assim que o `<Bust>` monta (invalidate automático de commit), num
   * `requestAnimationFrame` — e passive effect (`useEffect`) não tem garantia
   * de rodar ANTES desse rAF, só antes do próximo paint em geral. Ganhando a
   * corrida, o quadro desenha bind pose (T-pose) antes da pose idle existir,
   * e como o retrato só redesenha por `invalidate()` (24 Hz via `Pulso`), a
   * T-pose fica visível por vários quadros em vez de sumir no seguinte. No
   * mundo 3D (`frameloop` padrão, 60 Hz) isso nunca se via porque o próximo
   * quadro chegava sozinho de qualquer forma. `useLayoutEffect` roda
   * SÍNCRONO, antes de qualquer paint — a pose já está certa quando o
   * primeiro quadro é agendado.
   */
  useLayoutEffect(() => {
    const a = pegarAction(clipSet.idle);
    if (a) {
      a.reset().play();
      current.current = clipSet.idle;
      mixer.update(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, porNome]);

  // crossfade curto: transição idle↔walk↔run responde na hora (não "bloqueia")
  const FADE = 0.08;
  const play = (role: ClipRole) => {
    const name = clipSet[role];
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
  const playOnce = (role: ClipRole, speed = 1): number => {
    const name = clipSet[role];
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
