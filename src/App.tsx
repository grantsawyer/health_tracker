import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { DataExplorer } from "./DataExplorer";
import { SetupWizard } from "./SetupWizard";
import { DashboardShell } from "./dashboard/DashboardShell";
import { Preferences } from "./Preferences";
import { Icon } from "./ui/icons";
import type { StatusResponse } from "../shared/types";

const DASH_TABS = [
  { id: "today", label: "Today", icon: Icon.today },
  { id: "fitness", label: "Fitness", icon: Icon.fitness },
  { id: "sleep", label: "Sleep", icon: Icon.sleep },
  { id: "food", label: "Food", icon: Icon.food },
  { id: "body", label: "Body", icon: Icon.body },
] as const;
const OTHER_TABS = [
  { id: "explorer", label: "Data explorer", icon: Icon.data },
  { id: "connection", label: "Account", icon: Icon.account },
] as const;
const TABS = [...DASH_TABS, ...OTHER_TABS];
type Tab = (typeof TABS)[number]["id"];
export type DashboardTab = (typeof DASH_TABS)[number]["id"];
const isDashTab = (t: Tab): t is DashboardTab => DASH_TABS.some((d) => d.id === t);

const TAB_KEY = "health-tracker:tab";
const RAIL_KEY = "health-tracker:rail-collapsed";
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
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setCollapsed = (c: boolean) => {
    setCollapsedState(c);
    try {
      localStorage.setItem(RAIL_KEY, c ? "1" : "0");
    } catch {
      /* not persisted */
    }
  };
  const [authError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) window.history.replaceState(null, "", window.location.pathname);
    return err;
  });

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", `${window.location.search}#${t}`);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not persisted */
    }
    window.scrollTo({ top: 0 });
  }, []);

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
  const navButton = (t: (typeof TABS)[number]) => (
    <button key={t.id} className="nav-btn" onClick={() => setTab(t.id)} aria-current={activeTab === t.id ? "page" : undefined}
      title={collapsed ? t.label : undefined} aria-label={t.label}>
      <t.icon /><span>{t.label}</span>
    </button>
  );

  return (
    <div className={`shell ${collapsed ? "rail-collapsed" : ""}`}>
      <aside className="rail">
        <div className="brand"><span className="brand-mark"><Icon.heart /></span><span>Health Tracker</span></div>
        {connected && (
          <nav className="nav" aria-label="Sections">
            {DASH_TABS.map(navButton)}
            <div className="nav-sep" role="separator" />
            {OTHER_TABS.map(navButton)}
          </nav>
        )}
        <button className="nav-btn rail-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <Icon.chevronRight /> : <Icon.chevronLeft />}<span>Collapse</span>
        </button>
      </aside>

      <main className="main">
        {isDashTab(activeTab) ? (
          <DashboardShell tab={activeTab} onReauth={refresh} onNavigate={setTab} />
        ) : activeTab === "explorer" ? (
          <DataExplorer />
        ) : (
          <div className="account">
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
                <>
                  {connected && <Preferences />}
                  <ConnectionCard status={status} onLogin={api.login} onLogout={logout} onRetry={refresh} onSetup={() => setShowSetup(true)} />
                </>
              )
            )}
          </div>
        )}
      </main>
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
