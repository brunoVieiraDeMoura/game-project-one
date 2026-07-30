"use client";

/**
 * Dimensionamento de Assets: embute a tela do game (localhost:3001) que tem as
 * miniaturas 3D + escala editável por asset. Persiste em localStorage (mesmo
 * origin do editor), então a escala definida vira a escala inicial no editor.
 */
const GAME_URL = process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:3001";

export default function AssetScalingPage() {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h1 className="text-sm font-semibold">Dimensionamento de Assets</h1>
        <span className="text-xs text-zinc-500">escala default por asset (usada no editor de mapas)</span>
        <a href="/" className="ml-auto text-xs text-blue-400 hover:underline">
          ← dashboard
        </a>
      </div>
      <iframe src={`${GAME_URL}/asset-scaling`} className="flex-1 border-0" title="Dimensionamento de Assets" />
    </main>
  );
}
