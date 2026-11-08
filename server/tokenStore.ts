import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { KEY_FILE, TOKEN_FILE } from "./config.js";

/**
 * OAuth tokens persisted on disk, encrypted with AES-256-GCM.
 *
 * The key lives in a separate 0600 file in the same directory. This does NOT
 * protect against someone with access to your user account (they can read
 * both files); it protects against the token file being copied, synced, or
 * backed up on its own, and keeps the plaintext refresh token off disk.
 */
export interface StoredTokens {
  accessToken: string;
  /** epoch ms */
  accessTokenExpiresAt: number;
  refreshToken: string;
  /** epoch ms, if Google reported refresh_token_expires_in (Testing mode: ~7 days) */
  refreshTokenExpiresAt?: number;
  /** space-separated scopes actually granted */
  scope: string;
  email?: string;
}

function getKey(): Buffer {
  if (existsSync(KEY_FILE)) {
    const key = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
    if (key.length === 32) return key;
    throw new Error(`${KEY_FILE} is not a valid 32-byte key`);
  }
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key.toString("base64"), { mode: 0o600 });
  return key;
}

export function saveTokens(tokens: StoredTokens): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  const payload = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") };
  writeFileSync(TOKEN_FILE, JSON.stringify(payload), { mode: 0o600 });
}

export function loadTokens(): StoredTokens | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const payload = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(payload.body, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as StoredTokens;
  } catch (err) {
    console.warn("[tokens] could not decrypt token file; treating as signed out:", (err as Error).message);
    return null;
  }
}

export function clearTokens(): void {
  rmSync(TOKEN_FILE, { force: true });
}
