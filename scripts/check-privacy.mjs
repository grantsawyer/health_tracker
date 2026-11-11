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
 *   node scripts/check-privacy.mjs --history every commit message, file path and added line in all commits
 *                                            (run before the repo goes public; history is published too)
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
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const patternNo = (p) => [...patterns].indexOf(p) + 1;

if (process.argv.includes("--history")) {
  // One pass over every commit: message, then the patch with only added lines kept. Binary diffs show no text.
  // The lockfile is skipped for the same reason as below.
  const out = git("log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=%x00COMMIT %h%n%B");
  let commit = "?";
  let file = "(message)";
  let skip = false;
  let hits = 0;
  let commits = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("\0COMMIT ")) {
      commit = line.slice(8);
      file = "(message)";
      skip = false;
      commits++;
      continue;
    }
    let text = null;
    if (line.startsWith("diff --git ")) {
      file = line.replace(/^diff --git a\/.* b\//, "");
      skip = file === "package-lock.json";
      text = line; // paths are published too
    } else if (file === "(message)") {
      text = line;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      text = line.slice(1);
    }
    if (text === null || skip) continue;
    for (const p of patterns) {
      if (text.includes(p)) {
        hits++;
        // Show where, not what: the matched value itself is private.
        console.error(`  ${commit} ${file} contains a private value (pattern #${patternNo(p)})`);
      }
    }
  }
  if (hits) {
    console.error(`check-privacy --history: ${hits} match${hits === 1 ? "" : "es"} in history. Do not publish.`);
    process.exit(1);
  }
  console.log(`check-privacy --history: ${commits} commit(s) clean (${patterns.size} private patterns checked).`);
  process.exit(0);
}
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
        console.error(`  ${file}:${i + 1} contains a private value (pattern #${patternNo(p)})`);
      }
    }
  });
}
if (hits) {
  console.error(`check-privacy: ${hits} match${hits === 1 ? "" : "es"} of personal data. Remove them before committing.`);
  process.exit(1);
}
console.log(`check-privacy: ${files.length} file(s) clean (${patterns.size} private patterns checked).`);
