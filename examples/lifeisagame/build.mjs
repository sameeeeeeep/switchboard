// build.mjs — bundle src/main.js (+ three, addons, missions) into the self-contained game.js
import { build } from "esbuild";
await build({ entryPoints: ["src/main.js"], bundle: true, format: "esm", outfile: "game.js", logLevel: "info", legalComments: "none" });
