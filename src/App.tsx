import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { DataExplorer } from "./DataExplorer";
import { SetupWizard } from "./SetupWizard";
import { DashboardShell } from "./dashboard/DashboardShell";
import type { StatusResponse } from "../shared/types";

const TABS = [
  { id: "today", label: "Today" },
  { id: "fitness", label: "Fitness" },
  { id: "sleep", label: "Sleep" },
  { id: "food", label: "Food" },
  { id: "body", label: "Body" },
  { id: "explorer", label: "Data explorer" },
  { id: "connection", label: "Account" },
] as const;
type Tab = (typeof TABS)[number]["id"];
export type DashboardTab = Extract<Tab, "today" | "fitness" | "sleep" | "food" | "body">;

const TAB_KEY = "health-tracker:tab";
const initialTab = (): Tab => {
  const hash = window.location.hash.slice(1);
  if (TABS.some((x) => x.id === hash)) return hash as Tab;
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : "today";
  } catch {
    return "today";
  }
};

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [showSetup, setShowSetup] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) window.history.replaceState(null, "", window.location.pathname);
    return err;
  });

  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", `#${t}`);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not persisted */
    }
  };

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await api.status());
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = async () => {
    await api.logout();
    await refresh();
  };

  const connected = status?.state === "connected";
  const activeTab: Tab = connected ? tab : "connection";
  const isDashboard = activeTab === "today" || activeTab === "fitness" || activeTab === "sleep" || activeTab === "food" || activeTab === "body";

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Health Tracker</h1>
        {connected && (
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} className={activeTab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}
                aria-current={activeTab === t.id ? "page" : undefined}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {isDashboard ? (
        <main className="content">
          <DashboardShell tab={activeTab as DashboardTab} onReauth={refresh} />
        </main>
      ) : activeTab === "explorer" ? (
        <main className="content">
          <DataExplorer />
        </main>
      ) : (
      <main className="content">
        {authError && (
          <div className="banner banner-error" role="alert">
            Sign-in failed: {describeAuthError(authError)}
          </div>
        )}
        {loadError && (
          <div className="banner banner-error" role="alert">
            Couldn't reach the local server. Is <code>npm run dev</code> running? <span className="muted">({loadError})</span>
          </div>
        )}
        {!status && !loadError && <p className="muted">Checking connection…</p>}
        {status && (status.state === "not_configured" || showSetup) ? (
          <SetupWizard
            onSaved={() => {
              setShowSetup(false);
              void refresh();
            }}
            onCancel={status.state === "not_configured" ? undefined : () => setShowSetup(false)}
          />
        ) : (
          status && (
            <ConnectionCard
              status={status}
              onLogin={api.login}
              onLogout={logout}
              onRetry={refresh}
              onSetup={() => setShowSetup(true)}
            />
          )
        )}
      </main>
      )}
    </div>
  );
}

function describeAuthError(code: string): string {
  if (code === "access_denied") return "you declined access on Google's consent screen.";
  if (code === "not_configured") return "Google credentials aren't set up yet.";
  if (code.includes("invalid_client")) return "Google rejected the client ID or secret. Use “Change Google credentials” to re-enter them.";
  if (code === "org_internal" || code.includes("access_denied")) return "access was denied. Check that your account is listed as a test user (setup step 5).";
  return code;
}

interface CardProps {
  status: StatusResponse;
  onLogin: () => void;
  onLogout: () => void;
  onRetry: () => void;
  onSetup: () => void;
}

function ConnectionCard({ status, onLogin, onLogout, onRetry, onSetup }: CardProps) {
  switch (status.state) {
    case "not_configured":
      return null; // handled by SetupWizard
    case "signed_out":
      return (
        <section className="card">
          <h2>Connect Google Health</h2>
          <p>Google credentials are saved. Sign in with the Google account you added as a test user.</p>
          <p className="muted">
            If Google shows “Access blocked” or “redirect_uri_mismatch”, recheck steps 5–7 in{" "}
            <button className="link" onClick={onSetup}>setup</button>.
          </p>
          <div className="actions">
            <button className="primary" onClick={onLogin}>Sign in with Google</button>
            <button onClick={onSetup}>Change Google credentials</button>
          </div>
        </section>
      );
    case "reauth_required":
      return (
        <section className="card">
          <h2>Sign in again</h2>
          <p>
            Your Google sign-in expired. While the app's OAuth client is in Testing mode, Google expires it every 7
            days.
          </p>
          <button className="primary" onClick={onLogin}>Sign in with Google</button>
        </section>
      );
    case "account_not_linked":
      return (
        <section className="card">
          <h2>Link your account in Google Health</h2>
          <p>{status.message}</p>
          <ScopeList status={status} />
          <div className="actions">
            <button className="primary" onClick={onRetry}>Retry</button>
            <button onClick={onLogout}>Sign out</button>
          </div>
        </section>
      );
    case "error":
      return (
        <section className="card">
          <h2>Something went wrong</h2>
          <p className="error-text">{status.message}</p>
          <div className="actions">
            <button className="primary" onClick={onRetry}>Retry</button>
            <button onClick={onLogout}>Sign out</button>
            <button onClick={onSetup}>Change Google credentials</button>
          </div>
        </section>
      );
    case "connected":
      return (
        <section className="card">
          <h2>
            <span className="dot dot-ok" aria-hidden /> Connected
          </h2>
          <dl className="facts">
            <dt>Google account</dt>
            <dd>{status.email ?? "—"}</dd>
            <dt>Health user ID</dt>
            <dd><code>{status.healthUserId ?? "—"}</code></dd>
            {status.refreshTokenExpiresAt && (
              <>
                <dt>Sign-in expires</dt>
                <dd>{new Date(status.refreshTokenExpiresAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
          <ScopeList status={status} />
          <div className="actions">
            <button onClick={onLogout}>Sign out</button>
          </div>
        </section>
      );
  }
}

function ScopeList({ status }: { status: StatusResponse }) {
  if (!status.scopes) return null;
  const missing = status.scopes.filter((s) => !s.granted);
  return (
    <>
      <h3>Permissions</h3>
      <ul className="scopes">
        {status.scopes.map((s) => (
          <li key={s.key}>
            <span className={`dot ${s.granted ? "dot-ok" : "dot-off"}`} aria-hidden />
            {s.label}
            {!s.granted && <span className="muted"> (not granted)</span>}
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="muted">
          Features that need a missing permission will be disabled. Sign out and sign in again to grant it.
        </p>
      )}
    </>
  );
}
