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
 *
 * Minified on purpose. The readable sources are in this repo; what ships is a
 * payload on someone else's page, and minifying is what makes correctness
 * affordable — bundling dom-accessibility-api costs ~10 KB gzipped before
 * minification and ~0 after (77 KB raw / 26 KB gzip, against 78 KB / 26 KB
 * without it). See docs/08 §3.3 for why we carry it at all.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });

/**
 * Third-party code that ends up inside the bundle. MIT requires the copyright
 * and permission notice to travel with the distribution, so it is emitted into
 * the artifact rather than left in node_modules. `legalComments: "none"` is
 * safe here only because this banner carries them explicitly.
 */
const BUNDLED = ["@mcp-b/webmcp-polyfill", "dom-accessibility-api"];

function licenseBlock() {
  return BUNDLED.map((name) => {
    let pkg = { version: "?", license: "?" };
    try {
      pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
    } catch {
      return ` * ${name} — (package not found at build time)`;
    }
    let text = "";
    for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"]) {
      try {
        text = readFileSync(`node_modules/${name}/${file}`, "utf8").trim();
        break;
      } catch {
        /* try the next candidate name */
      }
    }
    const body = text
      ? text.split("\n").map((l) => ` *     ${l}`.trimEnd()).join("\n")
      : " *     (license text not found in the package; see npm for its terms)";
    return ` * ${name}@${pkg.version} — ${pkg.license}\n${body}`;
  }).join("\n *\n");
}

const banner = `/*!
 * page-mcp — dev/debug tools for a web UI, exposed over WebMCP.
 * Built from source in this repository. Bundles the following third-party code:
 *
${licenseBlock()}
 */`;

const result = await build({
  entryPoints: ["src/index.js"],
  outfile: "dist/page-mcp.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  banner: { js: banner },
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "info",
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`\ndist/page-mcp.js  ${(bytes / 1024).toFixed(1)} KB`);
