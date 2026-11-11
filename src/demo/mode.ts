/**
 * Demo mode switch (S6). Kept tiny because it ships in the main bundle; the demo itself
 * (src/demo/demoRuntime.ts and its synthetic data) is loaded with a dynamic import only when used.
 * The demo is the URL with `?demo`, so it survives reloads, can be linked, and leaves no state behind.
 */
export const isDemo = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).has("demo");
  } catch {
    return false;
  }
};

export function startDemo(): void {
  window.location.assign(`${window.location.pathname}?demo#today`);
}

export function exitDemo(): void {
  window.location.assign(window.location.pathname);
}
