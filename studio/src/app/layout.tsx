import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Mimos Catalog Studio",
  description: "Cadastro automático de produtos com pesquisa, redação e tratamento de imagens por IA.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body className="grain min-h-dvh antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-5 pt-10 pb-40 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
