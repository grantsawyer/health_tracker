import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Content Security Policy for production builds (GitHub Pages can't send headers, so it's a <meta> tag).
 * Tokens live in the page, so this limits what injected content could load or send them to.
 * Not used in dev: Vite's dev server injects inline scripts (the React refresh preamble).
 * GIS entries follow Google's "Content Security Policy" guidance for Sign in with Google.
 * frame-ancestors can't be set from <meta>; clickjacking risk is low (no one-click actions on load).
 */
export const CSP = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "style-src 'self' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  [
    "connect-src 'self'",
    "https://health.googleapis.com", // Google Health API
    "https://www.googleapis.com", // userinfo + Drive appDataFolder
    "https://accounts.google.com/gsi/",
    "https://world.openfoodfacts.org", // browser search (cgi/search.pl) + product by barcode
  ].join(" "),
].join("; ");

function cspMeta(): Plugin {
  return {
    name: "health-tracker-csp",
    apply: "build",
    // Right after <meta charset> (which must stay first) and before any stylesheet or script it governs.
    transformIndexHtml(html) {
      const charset = '<meta charset="UTF-8" />';
      if (!html.includes(charset)) throw new Error("csp: <meta charset> not found in index.html");
      return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app under the repo path: build with PAGES_BASE=/health_tracker/.
  // Routing is hash-only (#today), so no 404 fallback page is needed.
  base: process.env.PAGES_BASE ?? "/",
  plugins: [react(), cspMeta()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
});
