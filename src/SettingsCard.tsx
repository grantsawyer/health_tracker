import { useEffect, useRef, useState } from "react";
import { ApiError, api, backendMode } from "./api";
import { buildExport, exportFileName, newFavorites, parseImport } from "./settingsTransfer";
import type { SettingsSyncInfo } from "../shared/types";

/**
 * Where settings live (Drive sync status in browser mode) and moving them
 * between copies of the app: "Export settings" (goals, Today layout,
 * favorites as JSON) and "Import settings".
 */
export function SettingsCard() {
  const [sync, setSync] = useState<SettingsSyncInfo | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (backendMode !== "browser") return;
    void api.settingsSync().then(setSync);
    return api.watchSettingsSync(setSync);
  }, []);

  // Called straight from the click: Drive sign-in opens Google's pop-up.
  const connectDrive = () => {
    setSyncing(true);
    api.connectDrive().then(setSync, () => {}).finally(() => setSyncing(false));
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      setSync(await api.syncSettingsNow());
    } finally {
      setSyncing(false);
    }
  };

  const exportSettings = async () => {
    setMessage(null);
    try {
      const [goals, layout, favorites] = await Promise.all([api.goals(), api.layout(), api.food.favorites()]);
      const blob = new Blob([JSON.stringify(buildExport(goals, layout, favorites), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setMessage({ ok: false, text: `Couldn't export: ${(err as Error).message}` });
    }
  };

  const importSettings = async (file: File | undefined) => {
    setMessage(null);
    if (!file) return;
    setBusy(true);
    try {
      const data = parseImport(await file.text());
      if (data.goals && Object.keys(data.goals).length) await api.saveGoals(data.goals);
      if (data.layout) await api.saveLayout(data.layout);
      const toAdd = newFavorites(await api.food.favorites(), data.favorites);
      for (const t of toAdd) await api.food.addFavorite(t);
      const parts = [data.goals && "goals", data.layout && "Today layout", toAdd.length ? `${toAdd.length} favorite${toAdd.length === 1 ? "" : "s"}` : null].filter(Boolean);
      setMessage({ ok: true, text: parts.length ? `Imported ${parts.join(", ")}.` : "Nothing new to import." });
      if (backendMode === "browser") setSync(await api.syncSettingsNow());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError || err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-wide" aria-labelledby="settings-h">
      <h2 id="settings-h">Your settings</h2>
      <p className="muted">Goals, the Today layout and favorite foods. They contain no health data.</p>
      {backendMode === "browser" && sync && (
        <div className="sync-row">
          <span className={`dot ${sync.state === "synced" ? "dot-ok" : "dot-off"}`} aria-hidden />
          <span role="status">{describeSync(sync)}</span>
          {sync.state === "paused" || sync.state === "unavailable"
            ? <button className="primary" onClick={connectDrive} disabled={syncing}>{syncing ? "Connecting…" : "Connect Google Drive"}</button>
            : sync.state !== "off" && <button onClick={syncNow} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>}
        </div>
      )}
      <div className="actions">
        <button onClick={exportSettings}>Export settings</button>
        <button onClick={() => fileInput.current?.click()} disabled={busy}>{busy ? "Importing…" : "Import settings"}</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Settings file to import"
          onChange={(e) => { void importSettings(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {message && <p className={message.ok ? "muted" : "error-text"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </section>
  );
}

function describeSync(s: SettingsSyncInfo): string {
  switch (s.state) {
    case "synced":
      return `Synced with your Google Drive (${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}). Your settings follow you to other browsers.`;
    case "unavailable":
      return `Saved in this browser only. Drive sync isn't available: ${s.reason}`;
    case "error":
      return `Saved in this browser; Drive sync will retry. (${s.reason})`;
    case "paused":
      return "Saved in this browser. Connect Google Drive to sync your settings with your other browsers (Google asks separately for Drive).";
    case "local":
      return `Saved in this browser. ${s.reason}.`;
    case "off":
      return "Saved by the local server.";
  }
}
