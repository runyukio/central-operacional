import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Central Operacional",
  description: "Central operacional interna para BPO, WFM, escala, qualidade, RH, logística e gestão."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
