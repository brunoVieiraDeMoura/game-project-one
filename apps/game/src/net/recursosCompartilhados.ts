import * as THREE from "three";

/**
 * GEOMETRIAS E MATERIAIS DE MÓDULO, para o que toda entidade tem igual.
 *
 * ## O problema, medido
 *
 * Com `area_size: 60` o servidor anuncia um quadrado de 121×121 células, então é
 * entra-e-sai de mob o tempo todo. Cada `NetEntity` que nascia alocava um
 * `CylinderGeometry` (a área de clique), um `meshBasicMaterial` invisível, um
 * `ShaderMaterial` de brilho e um `PlaneGeometry` — quatro objetos que são
 * IDÊNTICOS entre todas as entidades da mesma escala. Cada item no chão alocava
 * mais quatro. O censo do `prt_fild08` contou **132 geometrias únicas** para 546
 * malhas, e boa parte dessas únicas é isto.
 *
 * Não era vazamento (o descarte existia), era pressão de coletor contínua — e o
 * GC apareceu no perfil de produção com Minor + Major + C++ ≈ **226 ms**.
 *
 * ## A regra que muda ao compartilhar
 *
 * **Quem usa NÃO descarta.** O `GlowChao` fazia `material.dispose()` na limpeza
 * porque o material era dele; compartilhado, esse mesmo `dispose` apagaria o
 * brilho de todas as outras entidades vivas. Recurso de módulo vive enquanto o
 * módulo viver — são poucas dezenas de objetos com teto fixo, não uma coleção
 * que cresce.
 *
 * ## Unitário + `scale`, nunca um tamanho por instância
 *
 * As geometrias são de tamanho 1 e o tamanho real vai no `scale` do mesh. Isso
 * é o que permite compartilhá-las entre entidades de raios diferentes, e o
 * raycast continua correto: o three transforma o raio para o espaço local do
 * objeto antes de testar, então a escala entra na conta de graça.
 */

/**
 * Cilindro unitário: raio 0,5 e altura 1, para `scale` dar o tamanho final.
 *
 * Dez segmentos radiais é o que a área de clique do mob sempre usou — ela nunca
 * é desenhada, só atingida por raio, e mais lados só encareceriam o teste.
 */
export const GEO_CILINDRO = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

/** caixa unitária — área de clique e a caixinha de loot */
export const GEO_CAIXA = new THREE.BoxGeometry(1, 1, 1);

/** plano unitário no plano XY — o disco de brilho do chão, girado por quem usa */
export const GEO_PLANO = new THREE.PlaneGeometry(1, 1);

/**
 * O material das áreas de CLIQUE.
 *
 * Some sem `visible={false}`, que faria o raycaster pular o objeto
 * (`Raycaster.intersectObject` sai cedo em `object.visible === false`) — era por
 * isso que clicar no mob não fazia nada. Aqui ele desaparece pelo material: não
 * escreve cor nem profundidade, e continua sendo atingível.
 */
export const MATERIAL_INVISIVEL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});

/**
 * Materiais de brilho de chão, um por COMBINAÇÃO — não um por entidade.
 *
 * As combinações são poucas e fixas: duas cores (inimigo e loot) × os quatro
 * níveis de força do realce × com e sem aro. Um punhado de materiais serve a
 * tela inteira, por mais mobs que haja.
 *
 * Nunca descartados, de propósito: ver "quem usa não descarta" no topo.
 */
const brilhos = new Map<string, THREE.ShaderMaterial>();

export function materialDeBrilho(
  cor: string,
  forca: number,
  aro: number,
  vert: string,
  frag: string,
): THREE.ShaderMaterial {
  const chave = `${cor}|${forca}|${aro}`;
  const pronto = brilhos.get(chave);
  if (pronto) return pronto;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCor: { value: new THREE.Color(cor) },
      uForca: { value: forca },
      uAro: { value: aro },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    // aditivo: o brilho SOMA à cor do chão em vez de cobri-la, que é o que faz
    // parecer luz e não um adesivo colado no terreno
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // TESTA profundidade — depthTest:false fazia o disco (fila transparente,
    // desenhada DEPOIS de toda a fila opaca) pintar por cima do personagem e do
    // monstro sempre, não importa a distância real: era o "círculo do target
    // sobrepõe o personagem/monstro". `polygonOffset` resolve o motivo original
    // de ter desligado o teste (a briga em z do quad PLANO contra um terreno em
    // encosta, "o círculo fica para dentro da montanha") sem abrir mão da
    // oclusão de verdade contra quem está EM CIMA do disco.
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  brilhos.set(chave, mat);
  return mat;
}

/**
 * Materiais opacos por COR — a caixinha de loot.
 *
 * A cor sai do id do item, então são tantos materiais quantos tipos de item
 * apareceram na sessão; sem o cache seria um por item CAÍDO, e um campo depois
 * de uma caçada tem dezenas do mesmo tipo.
 */
const opacos = new Map<string, THREE.MeshStandardMaterial>();

export function materialOpaco(cor: string, roughness = 0.6): THREE.MeshStandardMaterial {
  const chave = `${cor}|${roughness}`;
  const pronto = opacos.get(chave);
  if (pronto) return pronto;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cor), roughness });
  opacos.set(chave, mat);
  return mat;
}

/**
 * Materiais das BARRAS do mundo (`net/WorldBar`), por combinação.
 *
 * Cada barra empilha três planos — trilho, preenchimento e moldura —, e cada um
 * criava material próprio. Com plaquinha em todo mob à vista, são três por
 * entidade que entra no alcance. As combinações reais são poucas: dois modos de
 * profundidade × um punhado de cores de preenchimento × as duas ou três
 * texturas de moldura que o `ui/barTexture` já cacheia por proporção.
 *
 * `map` entra na chave pelo `uuid` da textura: a moldura muda com a proporção
 * da barra, e um material com a textura errada desenharia a moldura esticada.
 */
const barras = new Map<string, THREE.MeshBasicMaterial>();

export function materialDeBarra(opcoes: {
  cor?: string;
  map?: THREE.Texture | null;
  opacity?: number;
  depthTest: boolean;
}): THREE.MeshBasicMaterial {
  const { cor, map, opacity = 1, depthTest } = opcoes;
  const chave = `${cor ?? ""}|${map?.uuid ?? ""}|${opacity}|${depthTest}`;
  const pronto = barras.get(chave);
  if (pronto) return pronto;
  const mat = new THREE.MeshBasicMaterial({
    ...(cor ? { color: new THREE.Color(cor) } : {}),
    ...(map ? { map } : {}),
    opacity,
    // `transparent` mesmo opaco: o three desenha toda a lista transparente
    // depois da opaca, e o trilho é transparente — com o preenchimento fora
    // dessa lista o trilho passaria por cima dele
    transparent: true,
    depthTest,
    depthWrite: false,
  });
  barras.set(chave, mat);
  return mat;
}

/**
 * Materiais de ÍCONE DE ITEM (`net/itemIcons`), por url — a caixinha de loot
 * troca a cor sólida por este material quando o item tem sprite de verdade.
 *
 * `TextureLoader` fica junto do cache, não separado (ao contrário de
 * `vfx/core/assets/textureManager`, que é ref-counted para VFX efêmero): a
 * mesma regra de "quem usa não descarta" do resto deste arquivo vale aqui —
 * um item no chão nasce e morre o tempo todo, e a textura do ícone é a MESMA
 * a cada vez.
 */
const iconTexturas = new Map<string, THREE.Texture>();
const icones = new Map<string, THREE.MeshBasicMaterial>();

export function materialDeIcone(url: string): THREE.MeshBasicMaterial {
  const pronto = icones.get(url);
  if (pronto) return pronto;
  let textura = iconTexturas.get(url);
  if (!textura) {
    textura = new THREE.TextureLoader().load(url);
    textura.colorSpace = THREE.SRGBColorSpace;
    iconTexturas.set(url, textura);
  }
  const mat = new THREE.MeshBasicMaterial({
    map: textura,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  icones.set(url, mat);
  return mat;
}

/** para o diagnóstico e o teste: quantos materiais o cache guarda */
export function materiaisCompartilhados(): { brilhos: number; opacos: number; barras: number; icones: number } {
  return { brilhos: brilhos.size, opacos: opacos.size, barras: barras.size, icones: icones.size };
}

/** só para o teste — os caches são de módulo e sobrevivem entre casos */
export function zerarRecursosCompartilhados(): void {
  brilhos.clear();
  opacos.clear();
  barras.clear();
  icones.clear();
  iconTexturas.clear();
}
