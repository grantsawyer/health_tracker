import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env.PORT ?? 8787);
const target = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Same-origin in the browser: /api and /auth are forwarded to the local server.
    proxy: {
      "/api": { target },
      "/auth": { target },
    },
  },
});
