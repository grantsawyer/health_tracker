import { browserApi } from "./api.browser";
import type { Api } from "./apiTypes";

/**
 * The single seam between the UI and its backend: core/ + platform/ running in
 * the page, calling Google directly (no server). The demo (?demo) swaps the
 * platform underneath, in src/browser/runtime.ts.
 */
export const api: Api = browserApi;

export { ApiError, type CachedMeta, type DataTypeWithGrant, type PointsResponse, type RollupResponse, type Source } from "./apiTypes";
