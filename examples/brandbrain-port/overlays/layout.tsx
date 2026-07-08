import "./globals.css";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";

const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "brandbrain",
  description: "The launch & growth hub for consumer brands.",
};

// PORT OVERLAY: identical to brandbrain's root layout, plus the two injected scripts that make it a
// Switchboard app — the route bundle (mounts the fetch-router) then the bootstrap (connect + bind).
// Loaded from the static export root; `defer` keeps them after brandbrain's own hydration.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="bg-page font-sans text-ink antialiased">
        {children}
        <script src="/sb/routes.js" defer />
        <script src="/sb/bootstrap.js" defer />
      </body>
    </html>
  );
}
