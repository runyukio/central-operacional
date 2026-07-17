import type { Metadata } from "next";

import { LanguageProvider } from "@/components/language-provider";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Central Operacional",
  description: "Central operacional interna para BPO, WFM, cronograma, qualidade, RH, logística e gestão."
};

const themeScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("central-operacional-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = stored === "light" || stored === "dark" ? stored : prefersDark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();
`;

const languageScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("central-operacional-language");
    const language = stored === "en-US" ? "en-US" : "pt-BR";
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
  } catch {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: languageScript }} />
      </head>
      <body>
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
