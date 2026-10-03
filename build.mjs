/**
 * Build the CDN artifact: one self-contained IIFE.
 *
 * Constraints that come from the delivery model (a <script src> on someone
 * else's page):
 *   - single file, no imports at runtime
 *   - IIFE, not ESM: the host page may not be a module context
 *   - no globals leaked except one explicitly-namespaced handle
 *   - the WebMCP polyfill is bundled in, so the page works on browsers where
 *     `document.modelContext` is not natively available
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/index.js"],
  outfile: "dist/devtools.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  minify: false,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "info",
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`\ndist/devtools.js  ${(bytes / 1024).toFixed(1)} KB`);
