import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Bricolage_Grotesque } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { Providers } from "@/components/Providers";
import { t } from "@/i18n/t";
import "./globals.css";

const body = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], weight: ["400", "600"], variable: "--font-atkinson", display: "swap" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "600"], variable: "--font-atkinson-mono", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], axes: ["wdth", "opsz"], variable: "--font-bricolage", display: "swap" });

export const metadata: Metadata = { title: t("app.name"), icons: { icon: "/logo.svg" } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
