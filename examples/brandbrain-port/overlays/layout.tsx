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

// PORT OVERLAY: identical to brandbrain's root layout, plus the injected scripts that make it a
// Switchboard app — an inline HEAD preamble that owns window.fetch from the first parsed byte,
// then the route bundle (mounts the fetch-router) and the bootstrap (connect + bind), both defer.
//
// WHY the preamble exists: Next App Router chunks load `async`, so on a real CDN hydration can
// fire the app's fetch("/api/workspace") BEFORE the deferred sb scripts run — the call escaped to
// the static host, 404'd, and the app adopted an empty workspace over real data (the founder sees
// a normal page with their brands missing). The preamble intercepts /api/* synchronously during
// HTML parse — before any async chunk can execute — and QUEUES those calls until the router mounts
// and drains them (window.__sbRoute, set by installFetchShim). If no router ever mounts (sb script
// blocked), a 20s backstop flushes the queue to the network so behavior degrades to the old 404s.
const SB_FETCH_PREAMBLE = `(function(){var o=window.fetch.bind(window),q=[];window.__sbQ=q;window.fetch=function(i,n){var p;try{p=new URL(typeof i==="string"?i:i.url,location.href).pathname}catch(e){p=String(i)}if(p!=="/api"&&p.indexOf("/api/")!==0)return o(i,n);if(window.__sbRoute)return window.__sbRoute(i,n);return new Promise(function(r,j){q.push([i,n,r,j])})};setTimeout(function(){if(!window.__sbRoute&&q.length){var d=q.splice(0);for(var k=0;k<d.length;k++)o(d[k][0],d[k][1]).then(d[k][2],d[k][3])}},20000)})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // PORT_BASE_PATH prefixes the injected script src so they resolve under a subpath deploy;
  // basePath does not rewrite hand-written <script src>, so we prefix here.
  const base = process.env.PORT_BASE_PATH || "";
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SB_FETCH_PREAMBLE }} />
      </head>
      <body className="bg-page font-sans text-ink antialiased">
        {children}
        <script src={`${base}/sb/routes.js`} defer />
        <script src={`${base}/sb/bootstrap.js`} defer />
      </body>
    </html>
  );
}
