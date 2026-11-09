#!/usr/bin/env node
/**
 * Blocks personal data from being committed.
 *
 * The values to look for are NOT stored in this repo (that would publish them).
 * They come from files under HEALTH_TRACKER_HOME (default ~/.health_tracker):
 *   - private-patterns.txt: one literal string per line (# comments allowed),
 *     e.g. your email, Google Health user id, real measurements or food names;
 *   - .env: the real GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET values are added automatically.
 *
 * Usage:
 *   node scripts/check-privacy.mjs           scan every tracked file
 *   node scripts/check-privacy.mjs --staged  scan staged content (used by the pre-commit hook)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = process.env.HEALTH_TRACKER_HOME ?? join(homedir(), ".health_tracker");
const patterns = new Set();
const patternsFile = join(home, "private-patterns.txt");
if (existsSync(patternsFile)) {
  for (const line of readFileSync(patternsFile, "utf8").split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) patterns.add(t);
  }
}
const envFile = join(home, ".env");
if (existsSync(envFile)) {
  for (const m of readFileSync(envFile, "utf8").matchAll(/^GOOGLE_CLIENT_(?:ID|SECRET)=(.+)$/gm)) {
    if (m[1].trim()) patterns.add(m[1].trim());
  }
}
if (!patterns.size) {
  console.log(`check-privacy: no patterns found in ${patternsFile} or ${envFile}; nothing to check.`);
  process.exit(0);
}

const staged = process.argv.includes("--staged");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const files = (staged
  ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
  : git("ls-files", "--cached", "--others", "--exclude-standard")).split("\n").filter(Boolean)
  // Binary files and the lockfile (generated; full of hashes that can match short numbers by chance) are skipped.
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(f) && f !== "package-lock.json");

let hits = 0;
for (const file of files) {
  let text;
  try {
    text = staged ? git("show", `:${file}`) : readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const p of patterns) {
      if (line.includes(p)) {
        hits++;
        // Show where, not what: the matched value itself is private.
        console.error(`  ${file}:${i + 1} contains a private value (pattern #${[...patterns].indexOf(p) + 1})`);
      }
    }
  });
}
if (hits) {
  console.error(`check-privacy: ${hits} match${hits === 1 ? "" : "es"} of personal data. Remove them before committing.`);
  process.exit(1);
}
console.log(`check-privacy: ${files.length} file(s) clean (${patterns.size} private patterns checked).`);
