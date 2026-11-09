import { useEffect, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import type { SetupInfo } from "../shared/types";

/**
 * Guided Google Cloud setup. Walks through the Console steps with the exact
 * values to copy.
 * - Browser mode (default): only the OAuth client ID is needed (it isn't
 *   secret); it's saved in this browser. The client lists this site under
 *   "Authorized JavaScript origins".
 * - Server mode: the client ID and secret go to the local server
 *   (~/.health_tracker/.env), with a redirect URI instead of an origin.
 */

const CHECKLIST_KEY = "health-tracker:setup-checklist";

function loadChecked(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function SetupWizard({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(loadChecked);

  useEffect(() => {
    api.setupInfo().then(setInfo, (err: Error) => setError(err.message));
  }, []);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: checklist just won't persist */
      }
      return next;
    });

  if (error) return <div className="banner banner-error">Couldn't load setup info: {error}</div>;
  if (!info) return <p className="muted">Loading…</p>;
  const browser = info.mode === "browser";

  return (
    <div className="setup">
      <section className="card card-wide">
        <h2>Connect to Google Health</h2>
        <p>
          Google requires every app that reads Google Health data to be registered in Google Cloud. This is free, it
          doesn't host or store anything, and it takes about 15 minutes. Work through the steps below. Each link opens
          the right page in a new tab, and the copy buttons give you the exact values to paste.
        </p>
        {info.configured && (
          <p className="muted">
            {info.clientIdFromBuild ? "This site comes with a client ID" : "A client ID is already saved"} (
            <code>{info.clientIdHint}</code>). Saving a different one replaces it and signs you out.
          </p>
        )}
      </section>

      <ol className="steps">
        <Step id="link" n={1} title="Link your account in the Google Health app" checked={checked} toggle={toggle}>
          <p>
            On your phone, open the <strong>Google Health</strong> app and sign in with the Google account you want to
            use here. Until you do, Google rejects the app with an “account not linked” error.
          </p>
        </Step>

        <Step id="project" n={2} title="Create a Google Cloud project" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/projectcreate">New project</Ext>. Name it something like{" "}
            <code>health-tracker</code>, leave Organization as “No organization”, and click <strong>Create</strong>.
            Make sure the new project is selected in the project picker at the top of the page before you continue.
          </p>
        </Step>

        <Step id="api" n={3} title="Enable the Google Health API" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/apis/library/health.googleapis.com">Google Health API</Ext>{" "}
            and click <strong>Enable</strong>. If that link doesn't find it, go to APIs &amp; Services → Library and
            search for “Google Health API”.
          </p>
          {browser && (
            <p>
              Also enable the <Ext href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Google Drive
              API</Ext>. The app keeps your goals, Today layout and favorites in a small hidden file in your own Drive,
              so they follow you to other browsers. It can't see your other Drive files. If you skip this, settings stay
              in this browser only.
            </p>
          )}
        </Step>

        <Step id="branding" n={4} title="Set up the consent screen" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Ext> and click{" "}
            <strong>Get started</strong>:
          </p>
          <ul>
            <li><strong>App name:</strong> Health Tracker. <strong>User support email:</strong> your email.</li>
            <li><strong>Audience:</strong> choose <strong>External</strong>.</li>
            <li><strong>Contact information:</strong> your email. Agree to the policy, then click <strong>Create</strong>.</li>
          </ul>
        </Step>

        <Step id="testusers" n={5} title="Add yourself as a test user" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/auth/audience">Audience</Ext>. Leave the publishing status
            on <strong>Testing</strong>. Under <strong>Test users</strong>, click <strong>Add users</strong>, enter
            your Google email, and save.
          </p>
          <p className="muted">
            {browser
              ? "Google sign-in in a browser lasts about an hour, so expect a one-click “Continue” about once per visit. That's expected."
              : "Testing mode means you'll be asked to sign in again about once a week. That's expected."}
          </p>
        </Step>

        <Step id="scopes" n={6} title="Add the permissions (scopes)" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/auth/scopes">Data Access</Ext> → <strong>Add or remove
            scopes</strong>. Scroll to <strong>Manually add scopes</strong>, paste the list below, click{" "}
            <strong>Add to table</strong>, then <strong>Update</strong>, and finally <strong>Save</strong> at the bottom
            of the page.
          </p>
          <CopyBlock text={info.scopes.join("\n")} label="Copy all scopes" />
        </Step>

        <Step id="client" n={7} title="Create the OAuth client" checked={checked} toggle={toggle}>
          <p>
            Open <Ext href="https://console.cloud.google.com/auth/clients">Clients</Ext> → <strong>Create client</strong>:
          </p>
          <ul>
            <li><strong>Application type:</strong> Web application. <strong>Name:</strong> Health Tracker.</li>
            {browser ? (
              <>
                <li>
                  Under <strong>Authorized JavaScript origins</strong>, click <strong>Add URI</strong> and paste:
                  <CopyBlock text={info.javascriptOrigin} label="Copy origin" />
                  No redirect URI is needed.
                </li>
                <li>Click <strong>Create</strong>, then copy the <strong>Client ID</strong> (or download the JSON).</li>
              </>
            ) : (
              <>
                <li>
                  Leave <em>Authorized JavaScript origins</em> empty. Under <strong>Authorized redirect URIs</strong>, click{" "}
                  <strong>Add URI</strong> and paste:
                  <CopyBlock text={info.redirectUri ?? ""} label="Copy redirect URI" />
                </li>
                <li>
                  Click <strong>Create</strong>. In the dialog that appears, click <strong>Download JSON</strong>. Google
                  may only show the client secret this once.
                </li>
              </>
            )}
          </ul>
          {browser && (
            <p className="muted">
              Already have a client from the local-server version of this app? Open it instead, add the origin above
              under Authorized JavaScript origins, and save. The same client ID works, and entries you logged before stay
              editable.
            </p>
          )}
        </Step>

        <li className="step step-final">
          <div className="step-head">
            <span className="step-n">8</span>
            <h3>Give the credentials to this app</h3>
          </div>
          {browser ? <ClientIdForm onSaved={onSaved} origin={info.javascriptOrigin} initial={info.clientId ?? ""} /> : <CredentialsForm onSaved={onSaved} envFile={info.envFile ?? ""} />}
          {onCancel && (
            <div className="actions">
              <button onClick={onCancel}>Cancel</button>
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}

function Step(props: {
  id: string;
  n: number;
  title: string;
  checked: Record<string, boolean>;
  toggle: (id: string) => void;
  children: ReactNode;
}) {
  const done = Boolean(props.checked[props.id]);
  return (
    <li className={`step ${done ? "step-done" : ""}`}>
      <div className="step-head">
        <span className="step-n">{done ? "✓" : props.n}</span>
        <h3>{props.title}</h3>
        <label className="step-check">
          <input type="checkbox" checked={done} onChange={() => props.toggle(props.id)} /> Done
        </label>
      </div>
      {!done && <div className="step-body">{props.children}</div>}
    </li>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children} ↗
    </a>
  );
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is selectable below */
    }
  };
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button onClick={copy}>{copied ? "Copied ✓" : label}</button>
    </div>
  );
}

/** Accepts the JSON file Google lets you download, or the two values pasted by hand. */
function CredentialsForm({ onSaved, envFile }: { onSaved: () => void; envFile: string }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setFileNote(null);
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const client = json.web ?? json.installed;
      if (!client?.client_id || !client?.client_secret) throw new Error("no client_id / client_secret found");
      if (!json.web) setError("This JSON is for a Desktop client. Create a “Web application” client instead (step 7).");
      setClientId(client.client_id);
      setClientSecret(client.client_secret);
      const uris: string[] = client.redirect_uris ?? [];
      setFileNote(
        uris.length === 0 || uris.some((u) => u.includes("/auth/callback"))
          ? `Loaded ${file.name}.`
          : `Loaded ${file.name}, but its redirect URIs (${uris.join(", ")}) don't include this app's. Recheck step 7.`,
      );
    } catch (err) {
      setError(`Couldn't read that file as a Google client JSON (${(err as Error).message}).`);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveCredentials(clientId, clientSecret);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="step-body">
      <p>
        Choose the JSON file you downloaded in step 7. Or, if you didn't download it, copy the{" "}
        <strong>Client ID</strong> and <strong>Client secret</strong> from the client's page in Google Cloud and paste
        them below.
      </p>
      <label className="file-pick">
        <input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {fileNote && <p className="muted">{fileNote}</p>}
      <div className="form-grid form-grid-2">
        <label>
          Client ID
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1234567890-abc….apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-…"
            autoComplete="off"
          />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={save} disabled={saving || !clientId || !clientSecret}>
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </div>
      <p className="muted">
        Saved only on this computer, in <code>{envFile}</code> (readable by your user account only). It never goes
        into the code repository.
      </p>
    </div>
  );
}

/** Browser mode: the client ID only, from the downloaded JSON or pasted. Saved in this browser. */
function ClientIdForm({ onSaved, origin, initial }: { onSaved: () => void; origin: string; initial: string }) {
  const [clientId, setClientId] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError(null);
    setNote(null);
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const client = json.web ?? json.installed;
      if (!client?.client_id) throw new Error("no client_id found");
      if (!json.web) setError("This JSON is for a Desktop client. Create a “Web application” client instead (step 7).");
      setClientId(client.client_id);
      const origins: string[] = client.javascript_origins ?? [];
      setNote(origins.includes(origin)
        ? `Loaded ${file.name}.`
        : `Loaded ${file.name}, but its JavaScript origins don't include ${origin}. Add it to the client (step 7), or sign-in will fail.`);
    } catch (err) {
      setError(`Couldn't read that file as a Google client JSON (${(err as Error).message}).`);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveCredentials(clientId);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="step-body">
      <p>
        Paste the <strong>Client ID</strong> from the client's page in Google Cloud, or choose the JSON file you
        downloaded. No client secret is needed: this app talks to Google directly from your browser.
      </p>
      <label className="file-pick">
        <input type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {note && <p className="muted">{note}</p>}
      <label>
        Client ID
        <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)}
          placeholder="1234567890-abc….apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={save} disabled={saving || !clientId}>{saving ? "Saving…" : "Save and continue"}</button>
      </div>
      <p className="muted">Saved in this browser only. A client ID isn't secret, so it's safe to keep here.</p>
    </div>
  );
}
