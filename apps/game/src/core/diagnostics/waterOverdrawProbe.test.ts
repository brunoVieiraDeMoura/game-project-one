import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { coletarMalhasDeAgua, medirOverdrawDeAgua } from "./waterOverdrawProbe";

describe("coletarMalhasDeAgua", () => {
  it("acha meshes dentro de qualquer <group name=\"agua\">, em qualquer profundidade", () => {
    const scene = new THREE.Scene();
    const chunk = new THREE.Group();
    const agua = new THREE.Group();
    agua.name = "agua";
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    agua.add(mesh);
    chunk.add(agua);
    scene.add(chunk);

    const encontradas = coletarMalhasDeAgua(scene);
    expect(encontradas).toHaveLength(1);
    expect(encontradas[0]).toBe(mesh);
  });

  it("ignora grupos com outro nome (chão, props) mesmo com mesh dentro", () => {
    const scene = new THREE.Scene();
    const chao = new THREE.Group();
    chao.name = "chunks";
    chao.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
    scene.add(chao);
    expect(coletarMalhasDeAgua(scene)).toHaveLength(0);
  });

  it("soma malhas de água de VÁRIOS chunks — um grupo \"agua\" por chunk, como SquareTerrain gera", () => {
    const scene = new THREE.Scene();
    for (let i = 0; i < 5; i++) {
      const agua = new THREE.Group();
      agua.name = "agua";
      agua.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
      scene.add(agua);
    }
    expect(coletarMalhasDeAgua(scene)).toHaveLength(5);
  });
});

describe("medirOverdrawDeAgua", () => {
  it("devolve null quando não há água na cena — nunca toca o renderer nesse caso", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    // renderer nunca deveria ser chamado no caminho sem água — um objeto que
    // lança em qualquer método prova isso sem precisar de WebGL de verdade
    const rendererQueNuncaDeveriaSerChamado = new Proxy(
      {},
      {
        get() {
          throw new Error("medirOverdrawDeAgua não deveria tocar o renderer quando não há água");
        },
      },
    ) as unknown as THREE.WebGLRenderer;
    expect(medirOverdrawDeAgua(rendererQueNuncaDeveriaSerChamado, scene, camera)).toBeNull();
  });
});
