#!/usr/bin/env node
/**
 * Blocks credentials and coding-agent settings files from being committed.
 *
 * Complements check-privacy.mjs (which looks for the owner's own private values, kept outside the repo). This
 * script contains no private data, so it also runs in CI on the public repo.
 *
 * Why: coding agents save approved commands verbatim. Claude Code's "Yes, and don't ask again" writes the full
 * command text, including any token or password in it, to .claude/settings.local.json. Claude Code only ignores that
 * file in the user's *global* gitignore, which other clones and machines don't have; Apiiro found 1,122 public
 * copies holding real secrets (Nov 2026). So:
 *   1. agent-local files must never be tracked or staged, even if force-added past .gitignore;
 *   2. nothing that looks like a credential may be committed anywhere.
 *
 * Usage:
 *   node scripts/check-secrets.mjs            tracked + untracked (not ignored) files in the working tree
 *   node scripts/check-secrets.mjs --staged   the staged content only
 *   node scripts/check-secrets.mjs --history  every path ever added and every line ever added, in all commits (CI)
 *
 * Synthetic test values are allowed when the match itself says so (contains test, example, synthetic, fake, dummy,
 * placeholder, e2e or seeded), e.g. "GOCSPX-test-secret-value". Real credentials never contain those words.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Paths that must never be in a commit (agent permission/memory files, secrets, local data). */
const FORBIDDEN_PATHS = [
  // Agent folders are treated like .env (Apiiro's guidance): settings, approved commands, memory and chat logs.
  [/(^|\/)\.claude\/settings\.local\.json$/, "Claude Code local settings (saved \"don't ask again\" commands)"],
  [/(^|\/)\.claude\//, "coding-agent folder (.claude/)"],
  [/(^|\/)\.cursor\//, "coding-agent folder (.cursor/)"],
  [/(^|\/)\.gemini\//, "coding-agent folder (.gemini/)"],
  [/(^|\/)\.specstory\//, "agent chat history (.specstory/)"],
  [/(^|\/)\.codex\//, "coding-agent folder (.codex/)"],
  [/(^|\/)\.aider[^/]*$/, "aider history/config"],
  [/(^|\/)(CLAUDE|AGENTS|GEMINI)\.local\.md$/, "local agent memory file"],
  [/(^|\/)\.mcp\.json$/, "MCP server config (often holds tokens)"],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, "environment file"],
  [/\.(pem|p12|pfx|key|enc)$/, "key or encrypted token file"],
  [/(^|\/)(client_secret|credentials)[^/]*\.json$/, "OAuth client / credentials file"],
  [/\.(db|sqlite3?)(-wal|-shm|-journal)?$/, "database file (cached health data)"],
  [/(^|\/)samples\//, "reference screenshots (personal data)"],
];

/** Credential signatures (kept specific to avoid flagging hashes and base64 images). */
const SIGNATURES = [
  [/GOCSPX-[A-Za-z0-9_-]{10,}/g, "Google OAuth client secret"],
  [/AIza[0-9A-Za-z_-]{35}/g, "Google API key"],
  [/ya29\.[0-9A-Za-z_-]{20,}/g, "Google OAuth access token"],
  [/1\/\/0[0-9A-Za-z_-]{30,}/g, "Google OAuth refresh token"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "Anthropic API key"],
  [/sk-(?:proj-)?[A-Za-z0-9]{32,}/g, "OpenAI API key"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/g, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{40,}/g, "GitHub fine-grained token"],
  [/(?:AKIA|ASIA)[0-9A-Z]{16}/g, "AWS access key"],
  [/xox[abposr]-[A-Za-z0-9-]{20,}/g, "Slack token"],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, "private key"],
  // Passwords inside commands (what "don't ask again" rules capture), not just provider key formats. A value that is
  // a variable reference ($VAR, ${VAR}, <placeholder>) is fine: that's the recommended way to pass secrets.
  [/\b(?:PGPASSWORD|MYSQL_PWD|[A-Z_]*PASSWORD|[A-Z_]*PASSWD)=(?![$<{]|"\$)[^\s"'`\\;)]{4,}/g, "password in an environment assignment"],
  [/\bsshpass\s+-p\s*(?![$<{]|"\$)[^\s"'`\\;)]{3,}/g, "sshpass password"],
  [/\bmysql(?:dump|admin)?\b[^\n"'`]{0,80}?\s-p(?![$<{]|"\$)[^\s"'`\\;)]{3,}/g, "mysql -p password"],
  [/\bBearer\s+(?![$<{]|"\$)[A-Za-z0-9._~+/=-]{20,}/g, "bearer token in a header"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:(?![$<{])[^\s@/"'`]{4,}@[^\s"'`]+/gi, "URL with an embedded password"],
  [/\bcurl\b[^\n"'`]{0,200}?\s(?:-u|--user)\s+[^\s:"'`]+:(?![$<{])[^\s"'`\\;)]{4,}/g, "curl user and password option"],
];
const SYNTHETIC = /test|example|synthetic|fake|dummy|placeholder|e2e|seeded/i;
/**
 * Exact fake values in commits made before this check existed (history can't change). Add only values that are
 * provably fake; never a real credential (rotate those instead).
 */
const KNOWN_FAKE = new Set(["GOCSPX-abcdefghij", "GOCSPX-new-secret-1"]);
const SKIP_CONTENT = /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$|(^|\/)package-lock\.json$/i;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const mode = process.argv.includes("--history") ? "history" : process.argv.includes("--staged") ? "staged" : "tree";
const problems = [];

const checkPath = (path, where) => {
  for (const [re, what] of FORBIDDEN_PATHS) if (re.test(path)) problems.push(`${where}${path}: ${what} must not be committed`);
};
const checkLine = (line, where) => {
  for (const [re, what] of SIGNATURES) {
    for (const m of line.matchAll(re)) {
      if (SYNTHETIC.test(m[0]) || KNOWN_FAKE.has(m[0])) continue;
      // Show where and what kind, never the value.
      problems.push(`${where}: looks like a ${what} (${m[0].slice(0, 6)}…, ${m[0].length} chars)`);
    }
  }
};

if (mode === "history") {
  for (const path of new Set(git("log", "--all", "--diff-filter=A", "--name-only", "--format=").split("\n").filter(Boolean))) {
    checkPath(path, "history: ");
  }
  let commit = "", file = "";
  for (const line of git("log", "--all", "-p", "--no-color", "--format=COMMIT %h").split("\n")) {
    if (line.startsWith("COMMIT ")) commit = line.slice(7);
    else if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && !SKIP_CONTENT.test(file)) checkLine(line, `${commit} ${file}`);
  }
} else {
  const files = (mode === "staged"
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    : git("ls-files", "--cached", "--others", "--exclude-standard")).split("\n").filter(Boolean);
  // Tracked files are checked even when .gitignore'd: a force-add bypasses ignore rules.
  for (const f of files) checkPath(f, "");
  for (const f of files) {
    if (SKIP_CONTENT.test(f)) continue;
    let text;
    try {
      text = mode === "staged" ? git("show", `:${f}`) : readFileSync(f, "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => checkLine(line, `${f}:${i + 1}`));
  }
}

if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  console.error(`check-secrets: ${problems.length} problem${problems.length === 1 ? "" : "s"}. Remove the file or value (and rotate any real credential that was exposed).`);
  process.exit(1);
}
console.log(`check-secrets: clean (${mode === "history" ? "all commits" : mode === "staged" ? "staged changes" : "working tree"}).`);
