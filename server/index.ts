import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { APP_ORIGIN, HOME_DIR, PORT, REDIRECT_URI, isConfigured } from "./config.js";
import { processPendingWrites } from "../core/food.js";
import { loadTokens } from "./tokenStore.js";

// Background retry of food entries Google couldn't accept yet (see server/food.ts).
const retryTick = () => {
  if (!isConfigured() || !loadTokens()) return;
  processPendingWrites().then(
    (r) => r.sent && console.log(`[queue] synced ${r.sent} entr${r.sent === 1 ? "y" : "ies"}, ${r.remaining} due`),
    (err) => console.warn("[queue] retry failed:", (err as Error).message),
  );
};
setInterval(retryTick, 60_000).unref();
setTimeout(retryTick, 5_000).unref();

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] app origin: ${APP_ORIGIN}`);
  console.log(`[server] OAuth redirect URI: ${REDIRECT_URI}`);
  console.log(`[server] data dir: ${HOME_DIR}${isConfigured() ? "" : "  (⚠ client ID/secret not configured)"}`);
});
