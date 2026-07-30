import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// raiz do MONOREPO. Sem isto o Turbopack sobe procurando lockfile, acha o
// C:\Users\<user>\package-lock.json (fora do projeto) e passa a resolver tudo
// como "[project]/Desktop/game-project/..." — o manifest de client components
// não bate e toda rota morre em 500 ("Could not find the module ... in the
// React Client Manifest").
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@ragnarok/game-data", "@ragnarok/map-format"],
  turbopack: { root: repoRoot },
};

export default nextConfig;
