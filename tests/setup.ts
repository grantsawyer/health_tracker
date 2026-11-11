import { afterEach } from "vitest";

// Each test file gets its own module graph, so this registers a fresh in-memory core/platform per file.
await import("./helpers/testPlatform.js");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
