import { browserApi } from "./api.browser";
import { serverApi } from "./api.server";
import type { Api } from "./apiTypes";
import type { BackendMode } from "../shared/types";

/**
 * The single seam between the UI and its backend.
 *
 * Default (browser mode): calls Google directly from the page through core/ +
 * platform/; no server. `VITE_BACKEND=server` (npm run dev:server-mode) uses
 * the local Node server instead, kept as a fallback until migration phase 6.
 */
export const backendMode: BackendMode = import.meta.env.VITE_BACKEND === "server" ? "server" : "browser";

export const api: Api = backendMode === "server" ? serverApi : browserApi;

export { ApiError, type CachedMeta, type DataTypeWithGrant, type PointsResponse, type RollupResponse, type Source } from "./apiTypes";
