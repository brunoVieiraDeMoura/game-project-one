import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// raiz do MONOREPO. Sem isto o Turbopack sobe procurando lockfile, acha o
// C:\Users\<user>\package-lock.json (fora do projeto) e passa a resolver tudo
// como "[project]/Desktop/game-project/..." — o manifest de client components
// não bate e toda rota morre em 500 ("Could not find the module ... in the
// React Client Manifest").
//
// `realpathSync.native`: o Windows é case-insensitive mas os symlinks do pnpm
// (node_modules/next → node_modules/.pnpm/...) apontam pro casing REAL do
// disco ("Desktop"). Se o shell que abriu o dev server usa outro casing
// ("desktop", como este projeto todo referencia), a comparação de prefixo do
// Turbopack é case-SENSITIVE e falha — "não achou next/package.json" mesmo
// ele existindo, porque a string não bate byte a byte. `realpathSync` comum
// NÃO corrige o casing no Windows (só resolve symlink); só a variante
// `.native` (GetFinalPathNameByHandle) devolve o casing verdadeiro do disco,
// o mesmo que o symlink usa.
const repoRoot = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

const nextConfig: NextConfig = {
  transpilePackages: ["@ragnarok/game-data", "@ragnarok/map-format"],
  turbopack: { root: repoRoot },
};

export default nextConfig;
