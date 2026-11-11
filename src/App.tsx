import { useCallback, useEffect, useState } from "react";
import type { SetupInfo } from "../shared/types";
import { api } from "./api";
import { DataExplorer } from "./DataExplorer";
import { SetupWizard } from "./SetupWizard";
import { DashboardShell } from "./dashboard/DashboardShell";
import { Preferences } from "./Preferences";
import { SettingsCard } from "./SettingsCard";
import { exitDemo, isDemo, startDemo } from "./demo/mode";
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
  // Clicking anywhere in the sidebar except a button collapses or expands it (wide screens only; narrow screens
  // show a top bar instead). The Collapse button stays as the keyboard-accessible way to do the same.
  const onRailClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("button, a, input, select, textarea, label")) return;
    if (window.matchMedia("(max-width: 860px)").matches) return;
    setCollapsed(!collapsed);
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

  // Browser mode: sign out and remove everything this browser keeps for the account (cached data, settings copy,
  // unsent food entries). Warns with the number of unsent entries first, since those would be lost.
  const forget = async () => {
    const pending = await api.food.pending().catch(() => []);
    const lost = pending.length
      ? `\n\n${pending.length} food entr${pending.length === 1 ? "y hasn't" : "ies haven't"} reached Google Health yet and will be lost.`
      : "";
    if (!window.confirm(`Forget this device?\n\nThis signs you out and removes your cached health data, your settings copy and any unsent food entries from this browser. Your Google Health data and the settings in your Google Drive aren't affected.${lost}`)) return;
    await api.logout({ forgetDevice: true });
    await refresh();
  };

  const [signInError, setSignInError] = useState<string | null>(null);
  // Called straight from the click: browser mode opens Google's pop-up, which needs that click.
  const login = () => {
    setSignInError(null);
    api.login().then(refresh, (err: Error) => setSignInError(err.message));
  };

  const connected = status?.state === "connected";
  const demo = isDemo();
  // The setup and sign-in screens offer the demo (browser mode only; the demo runs in the page).
  const offerDemo = !demo && Boolean(status) && ["not_configured", "signed_out", "reauth_required"].includes(status!.state);
  const activeTab: Tab = connected ? tab : "connection";
  const navButton = (t: (typeof TABS)[number]) => (
    <button key={t.id} className="nav-btn" onClick={() => setTab(t.id)} aria-current={activeTab === t.id ? "page" : undefined}
      title={collapsed ? t.label : undefined} aria-label={t.label}>
      <t.icon /><span>{t.label}</span>
    </button>
  );

  return (
    <div className={`shell ${collapsed ? "rail-collapsed" : ""}`}>
      <aside className="rail" onClick={onRailClick}>
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
        {demo && (
          <div className="banner banner-demo" role="status">
            <strong>Demo data.</strong> Every value is synthetic, nothing is sent to Google, and your changes are gone
            when you reload. <button className="link" onClick={exitDemo}>Exit demo</button>
          </div>
        )}
        {isDashTab(activeTab) ? (
          <DashboardShell tab={activeTab} onReauth={refresh} onNavigate={setTab} onAccount={() => setTab("connection")} />
        ) : activeTab === "explorer" ? (
          <DataExplorer />
        ) : (
          <div className="account">
            {authError && (
              <div className="banner banner-error" role="alert">
                Sign-in failed: {describeAuthError(authError)}
              </div>
            )}
            {signInError && (
              <div className="banner banner-error" role="alert">
                Sign-in didn't finish: {signInError}
              </div>
            )}
            {loadError && (
              <div className="banner banner-error" role="alert">
                Couldn't start the app.{" "}
                <span className="muted">({loadError})</span>
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
                  {connected && <SettingsCard />}
                  <ConnectionCard status={status} onLogin={login} onLogout={logout} onForget={demo ? undefined : forget} onRetry={refresh} onSetup={() => setShowSetup(true)} />
                </>
              )
            )}
            {offerDemo && (
              <section className="card">
                <h2>Just looking?</h2>
                <p>Try the whole app on synthetic data. No Google account needed, and nothing is saved.</p>
                <div className="actions">
                  <button onClick={startDemo}>Try the demo</button>
                </div>
              </section>
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
  /** Browser mode: sign out and clear this browser's copy of the account's data. */
  onForget?: () => void;
  onRetry: () => void;
  onSetup: () => void;
}

function ConnectionCard({ status, onLogin, onLogout, onForget, onRetry, onSetup }: CardProps) {
  switch (status.state) {
    case "not_configured":
      return null; // handled by SetupWizard
    case "signed_out":
      return (
        <section className="card">
          <h2>Connect Google Health</h2>
          <p>Sign in with the Google account you added as a test user.</p>
          {status.message && <p className="error-text">{status.message}</p>}
          <SignInHelp onSetup={onSetup} />
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
            Your Google sign-in for this visit has ended. A web page can only stay signed in for about an hour without a
            click, so this is expected.
          </p>
          <div className="actions">
            <button className="primary" onClick={onLogin}>{status.email ? `Continue as ${status.email}` : "Sign in with Google"}</button>
            <button onClick={onLogout}>Use a different account</button>
          </div>
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
          </dl>
          <ScopeList status={status} />
          <div className="actions">
            <button onClick={onLogout}>Sign out</button>
            {onForget && <button onClick={onForget}>Forget this device</button>}
          </div>
          {onForget && (
            <p className="muted small">
              Sign out keeps your settings and any unsent food entries in this browser for next time. On a shared
              computer, use Forget this device.
            </p>
          )}
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

/**
 * Browser mode: what Google checks when the sign-in pop-up opens, so an
 * "Access blocked" page can be matched to the setting that's off.
 */
function SignInHelp({ onSetup }: { onSetup: () => void }) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  useEffect(() => {
    void api.setupInfo().then(setInfo, () => {});
  }, []);
  return (
    <details className="signin-help">
      <summary>Google says “Access blocked”?</summary>
      <p>On Google's error page, click <strong>error details</strong> and match the code:</p>
      <ul>
        <li>
          <strong>redirect_uri_mismatch</strong> (mentions <code>storagerelay://</code>) or <strong>origin_mismatch</strong>:
          this page's address isn't under <em>Authorized JavaScript origins</em> of the client below. Add it exactly
          (no trailing slash) and save; Google can take a few minutes to apply it.
        </li>
        <li><strong>access_denied</strong> / “has not completed the Google verification process”: add your account under Audience → Test users.</li>
        <li><strong>invalid_client</strong> or <strong>deleted_client</strong>: the client ID below is wrong; fix it in <button className="link" onClick={onSetup}>setup</button>.</li>
        <li><strong>invalid_scope</strong> or a scope error: add the scopes from setup step 6 on the Data Access page.</li>
      </ul>
      {info && (
        <dl className="facts">
          <dt>This page's origin</dt>
          <dd><code>{info.javascriptOrigin}</code></dd>
          <dt>Client ID in use</dt>
          <dd><code>{info.clientId ?? "none"}</code></dd>
        </dl>
      )}
    </details>
  );
}
