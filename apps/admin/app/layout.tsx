import type { Metadata } from "next";
import type React from "react";
import { BackBar } from "../components/BackBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin — Game Server",
  description: "Painel administrativo do servidor",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      {/* flex-col: a barra de voltar ocupa a altura dela e as telas que usam a
          janela inteira (editor de mapas) pegam o resto com flex-1 */}
      <body className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
        <BackBar />
        {children}
      </body>
    </html>
  );
}
