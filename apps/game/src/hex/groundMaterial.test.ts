import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { groundKey, makeGroundMaterial, ATLAS_GRASS_SRGB, type GroundSettings } from "./groundMaterial";

/** o material do tile vem do glTF: MeshStandardMaterial com o atlas em `map` */
function tileMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
  m.map = new THREE.Texture();
  return m;
}

const settings = (patch: Partial<GroundSettings> = {}): GroundSettings => ({
  groundMode: "atlas",
  groundColor: "#bfc537",
  groundTextureScale: 2.5,
  groundTextureStrength: 0.35,
  ...patch,
});

/** roda o onBeforeCompile como o three faria e devolve o shader resultante */
function compile(mat: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main(){\n#include <map_fragment>\n}",
  };
  mat.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe("makeGroundMaterial", () => {
  it("modo atlas devolve o material ORIGINAL (sem clone nem patch)", () => {
    const base = tileMaterial();
    expect(makeGroundMaterial(base, settings())).toBe(base);
  });

  it("modo cor clona (o material do glTF é compartilhado pelo cache do useGLTF)", () => {
    const base = tileMaterial();
    const out = makeGroundMaterial(base, settings({ groundMode: "color" }));
    expect(out).not.toBe(base);
    expect(base.onBeforeCompile.toString()).not.toContain("uGroundTarget");
  });

  it("injeta a cor escolhida e a cor de referência da grama, em LINEAR", () => {
    const out = makeGroundMaterial(tileMaterial(), settings({ groundMode: "color", groundColor: "#ff0000" }));
    const { uniforms, fragmentShader } = compile(out);
    const target = uniforms.uGroundTarget!.value as THREE.Vector3;
    const ref = uniforms.uGroundRef!.value as THREE.Vector3;
    // #ff0000 em linear continua (1,0,0)
    expect(target.x).toBeCloseTo(1, 5);
    expect(target.y).toBeCloseTo(0, 5);
    // a referência é a cor do atlas convertida — não pode ser o valor sRGB cru
    const srgb = new THREE.Color(ATLAS_GRASS_SRGB.r, ATLAS_GRASS_SRGB.g, ATLAS_GRASS_SRGB.b);
    const lin = srgb.clone().convertSRGBToLinear();
    expect(ref.x).toBeCloseTo(lin.r, 5);
    expect(ref.x).not.toBeCloseTo(srgb.r, 3);
    // o patch entra depois do map_fragment (onde diffuseColor já tem o atlas)
    expect(fragmentShader.indexOf("uGroundRef")).toBeGreaterThan(0);
    expect(fragmentShader).toContain("#include <map_fragment>");
  });

  it("modo cor NÃO aplica ruído; modo textura aplica", () => {
    const cor = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "color" })));
    expect(cor.uniforms.uGroundNoise!.value).toBe(0);
    const tex = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture", groundTextureStrength: 0.5 })));
    expect(tex.uniforms.uGroundNoise!.value).toBe(0.5);
  });

  it("o padrão usa posição de MUNDO (senão repete igual em cada hexágono)", () => {
    const out = makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture" }));
    const { vertexShader, fragmentShader } = compile(out);
    expect(vertexShader).toContain("modelMatrix");
    expect(vertexShader).toContain("vGroundWorld");
    expect(fragmentShader).toContain("vGroundWorld.xz");
    // o terreno é InstancedMesh: sem aplicar instanceMatrix, todo hexágono
    // enxerga a mesma posição e o padrão vira contorno hexagonal de novo
    expect(vertexShader).toContain("USE_INSTANCING");
    expect(vertexShader).toContain("instanceMatrix * gPos");
  });

  it("escala do padrão vira frequência (maior escala = repetição mais larga)", () => {
    const perto = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture", groundTextureScale: 1 })));
    const longe = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture", groundTextureScale: 10 })));
    expect(perto.uniforms.uGroundFreq!.value as number).toBeGreaterThan(longe.uniforms.uGroundFreq!.value as number);
  });

  it("a tolerância de matiz separa grama de terra e água (cores reais do atlas)", () => {
    const { uniforms } = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "color" })));
    const refDir = uniforms.uGroundRefDir!.value as THREE.Vector3;
    const tol = uniforms.uGroundTol!.value as number;
    // mesma conta do shader: cor linear normalizada pela luminância
    const dirOf = (r: number, g: number, b: number) => {
      const c = new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
      const l = Math.max(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 1e-4);
      return new THREE.Vector3(c.r / l, c.g / l, c.b / l);
    };
    const dist = (v: THREE.Vector3) => v.distanceTo(refDir);
    // toda a família da grama entra (topo → lateral → base do bloco)
    for (const [r, g, b] of [[191, 197, 55], [182, 188, 48], [162, 167, 33], [138, 142, 15], [133, 138, 12]]) {
      expect(dist(dirOf(r!, g!, b!))).toBeLessThan(tol);
    }
    // terra da estrada e água ficam de fora, com folga
    for (const [r, g, b] of [[223, 183, 135], [206, 153, 101], [41, 169, 224], [37, 131, 192], [31, 58, 132]]) {
      expect(dist(dirOf(r!, g!, b!))).toBeGreaterThan(tol * 2);
    }
  });

  it("preserva o degradê do bloco (lateral segue mais escura que o topo)", () => {
    const { uniforms, fragmentShader } = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "color" })));
    const refLum = uniforms.uGroundRefLum!.value as number;
    expect(refLum).toBeGreaterThan(0);
    // o shader escala a cor nova pela razão de luminância da amostra
    expect(fragmentShader).toContain("gLum / uGroundRefLum");
    expect(fragmentShader).toContain("uGroundTarget * shade");
  });

  it("o padrão só aparece nas faces viradas pra cima", () => {
    const { fragmentShader, vertexShader } = compile(makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture" })));
    expect(vertexShader).toContain("vGroundNormalW");
    expect(fragmentShader).toContain("clamp(vGroundNormalW.y");
  });

  it("cada combinação tem chave de programa própria (senão o three reusa shader)", () => {
    const a = makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture", groundColor: "#112233" }));
    const b = makeGroundMaterial(tileMaterial(), settings({ groundMode: "texture", groundColor: "#445566" }));
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(groundKey(settings())).toContain("atlas");
  });
});
