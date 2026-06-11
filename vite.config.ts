import { defineConfig } from "vite";
import { resolve } from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";

/**
 * Builds ONLY the verifier module into  public/assets/aprilgate.js  as a browser ESM
 * bundle. Your existing HTML pages (index.html, verify.html, dashboard.html …)
 * are left untouched and keep hosting exactly as they do now — Cloudflare Pages
 * serving the repo root. Nothing about your deploy changes except that one
 * built file now sits in /assets.
 *
 * Wire it into verify.html with a module script:
 *
 *   <script type="module">
 *     import { verifyShipment } from "/assets/aprilgate.js";
 *     window.verifyShipment = verifyShipment;   // if your inline handlers need it
 *   </script>
 *
 * Build:   npm run build        (one-off)
 *          npm run watch        (rebuild on save while developing)
 *
 * Cloudflare Pages: build command `npm run build`, leave output dir as the repo
 * root (the bundle lands in public/assets, which is already served).
 */
export default defineConfig({
  plugins: [
    // web3.js / anchor expect Node's Buffer; this shims it for the browser.
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true } }),
  ],
  // We do not use Vite to serve/copy HTML — Cloudflare serves public/ directly.
  publicDir: false,
  build: {
    outDir: "public/assets",
    emptyOutDir: false, // never wipe sibling assets or your HTML
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "aprilgate.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
