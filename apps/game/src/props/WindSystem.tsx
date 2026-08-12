import { useFrame } from "@react-three/fiber";
import { windUniforms } from "./wind";

/**
 * Avança `uWindTime` — UM `useFrame`, pro mapa inteiro. Mesmo padrão do
 * `uTempo` da água (`grid/SquareTerrain.tsx`): o uniform é mutado direto, sem
 * `setState`, e é o MESMO objeto que todo material com vento já referencia
 * (`windMaterialFor`) — nenhuma planta precisa de atualização individual.
 */
export function WindSystem() {
  useFrame((_, dt) => {
    windUniforms.uWindTime.value += dt;
  });
  return null;
}
