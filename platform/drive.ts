/**
 * Google Drive appDataFolder client for the synced settings file.
 *
 * The appDataFolder is hidden from the user's Drive UI and readable only by this
 * OAuth client, under the `drive.appdata` scope (one consent screen together
 * with the Google Health scopes). We keep exactly one small JSON file there.
 */

export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const SETTINGS_FILE = "settings.json";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** Drive can't be used: scope not granted, or Drive API disabled for the project. Settings stay local. */
export class DriveUnavailableError extends Error {}

export interface DriveFile<T> {
  id: string;
  doc: T;
}

export interface DriveAppData {
  /** The settings file, or null if it doesn't exist yet. */
  read<T>(): Promise<DriveFile<T> | null>;
  /** Create (id = null) or overwrite the file; resolves with its id. */
  write(id: string | null, doc: unknown): Promise<string>;
}

export interface DriveDeps {
  fetch?: typeof fetch;
  getAccessToken(): Promise<string>;
  /** Called after a 401 so the next getAccessToken() gets a fresh token. */
  invalidateAccessToken(): Promise<void>;
  fileName?: string;
}

export function createDriveAppData(deps: DriveDeps): DriveAppData {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const fileName = deps.fileName ?? SETTINGS_FILE;

  /** Authorized request with one retry after a 401; maps scope/API errors to DriveUnavailableError. */
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await deps.getAccessToken();
      const res = await doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0) {
        await deps.invalidateAccessToken();
        continue;
      }
      if (res.ok) return res;
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
      const reason = body?.error?.errors?.[0]?.reason ?? "";
      const message = body?.error?.message ?? `Google Drive returned ${res.status}`;
      // 403 insufficientPermissions / accessNotConfigured: the user didn't grant drive.appdata, or the
      // Drive API isn't enabled in the Cloud project. Neither is fixed by retrying.
      if (res.status === 403 && /insufficient|accessNotConfigured|forbidden|SERVICE_DISABLED/i.test(`${reason} ${message}`)) {
        throw new DriveUnavailableError(message);
      }
      throw new Error(`Google Drive: ${message}`);
    }
  }

  return {
    async read<T>() {
      const q = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name = '${fileName}' and trashed = false`,
        fields: "files(id, modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: "10",
      });
      const list = (await (await call(`${FILES}?${q}`)).json()) as { files?: { id: string }[] };
      const id = list.files?.[0]?.id; // newest wins if two devices ever created the file at once
      if (!id) return null;
      const doc = (await (await call(`${FILES}/${encodeURIComponent(id)}?alt=media`)).json()) as T;
      return { id, doc };
    },

    async write(id, doc) {
      const content = JSON.stringify(doc);
      if (id) {
        await call(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: content,
        });
        return id;
      }
      const boundary = `ht-${crypto.randomUUID()}`;
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify({ name: fileName, parents: ["appDataFolder"], mimeType: "application/json" }),
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        content,
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      return ((await res.json()) as { id: string }).id;
    },
  };
}
