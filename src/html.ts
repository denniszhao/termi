interface HtmlOptions {
  onboardingSeenPath: string;
  showOnboarding: boolean;
}

export function getHtml(options: HtmlOptions): string {
  const bootstrap = serializeJsonForHtml({
    onboardingSeenPath: options.onboardingSeenPath,
    showOnboarding: options.showOnboarding,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Termi</title>
  <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="manifest" href="/manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Termi">
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <div id="app-shell">
    <div id="terminal-brand">
      <span id="terminal-brand-logo">🍉</span><span id="terminal-brand-wordmark">termi</span><span id="status"><span id="status-dot"></span><span id="status-text">Connecting</span></span>
    </div>
    <div id="terminal"></div>
    <div id="keyboard"></div>
  </div>
  <div id="mobile-actions">
    <button id="kb-toggle" type="button" aria-label="Use device keyboard">&#9000;</button>
    <button id="vk-toggle" type="button" hidden aria-label="Hide virtual keyboard">&#8595;</button>
  </div>
  <div id="notice-overlay" hidden>
    <div id="notice-card" role="dialog" aria-modal="true">
      <h2 id="notice-title"></h2>
      <div id="notice-body"></div>
      <button id="notice-dismiss" type="button" hidden>Got it</button>
    </div>
  </div>
  <div id="onboarding-backdrop">
    <div id="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">Quick tour</h2>
      <ol id="onboarding-list">
        <li>On mobile, press the keyboard button to switch between virtual and OS-based keyboards.</li>
        <li>Swipe on the terminal to scroll through recent output.</li>
      </ol>
      <p id="onboarding-error" hidden>Couldn't save this yet. Try again.</p>
      <button id="onboarding-dismiss" type="button">Got it</button>
    </div>
  </div>
  <script id="termi-bootstrap" type="application/json">${bootstrap}</script>
  <script src="/app.js"></script>
</body>
</html>`;
}

export function getPendingApprovalHtml(options: {
  code: string;
  expiresAt: string;
  label: string;
}): string {
  const bootstrap = serializeJsonForHtml(options);

  return pairingPageHtml("Approve Termi", `
    <h1>Approve This Browser</h1>
    <p id="pairing-status">Check that the same 6-character code is shown in your local terminal, then approve it there.</p>
    <div id="pairing-details">
      <div class="pairing-code">${escapeHtml(options.code)}</div>
      <p class="pairing-meta">Browser label: ${escapeHtml(options.label)}</p>
      <p class="pairing-meta">Approval expires at ${escapeHtml(new Date(options.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}.</p>
    </div>
  `, `
    .pairing-code {
      margin: 0 0 16px;
      border: 1px solid #4b5563;
      border-radius: 14px;
      padding: 16px;
      background: #111827;
      text-align: center;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 0.24em;
    }
    .pairing-meta {
      font-size: 14px;
      color: #9ca3af;
    }
  `, `
  <script id="termi-pending-bootstrap" type="application/json">${bootstrap}</script>
  <script>
    const bootstrap = JSON.parse(document.getElementById("termi-pending-bootstrap").textContent || "{}");
    const detailsEl = document.getElementById("pairing-details");
    const statusEl = document.getElementById("pairing-status");
    let timer;

    async function pollStatus() {
      try {
        const response = await fetch("/pair/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = await response.json();
        if (data.status === "approved") {
          window.location.href = "/";
          return;
        }
        if (data.status === "rejected") {
          detailsEl.hidden = true;
          statusEl.textContent = data.message || "This approval request was rejected. Refresh to try again.";
          window.clearInterval(timer);
          return;
        }
        if (data.status === "expired") {
          detailsEl.hidden = true;
          statusEl.textContent = data.message || "This approval request expired. Refresh to generate a new request.";
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling on transient network failures.
      }
    }

    timer = window.setInterval(pollStatus, 2000);
    void pollStatus();
  </script>`);
}

export function getApprovalBusyHtml(message: string): string {
  return pairingPageHtml("Approval Pending", `
    <h1>Approval Already In Progress</h1>
    <p>${escapeHtml(message)}</p>
  `);
}

export function getReplaceSessionHtml(): string {
  return pairingPageHtml("Pair This Browser Instead", `
    <h1>Session Already Active</h1>
    <p>This terminal is currently active on another browser.</p>
    <p>Pair this browser instead if you want it to replace the current remote session after local approval.</p>
    <form method="post" action="/pair/request">
      <button type="submit">Pair This Browser Instead</button>
    </form>
  `, BUTTON_CSS_GREEN);
}

export function getActiveSessionHtml(options: { activeDeviceLabel: string }): string {
  return pairingPageHtml("Session In Use", `
    <h1>Session Already Active</h1>
    <p>This terminal is currently open on ${escapeHtml(options.activeDeviceLabel)}.</p>
    <p>You can take over the live session from this browser.</p>
    <form method="post" action="/takeover">
      <button type="submit">Take Over Session</button>
    </form>
  `, BUTTON_CSS_AMBER);
}

const BUTTON_CSS_GREEN = `
    button {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      background: #10b981;
      color: #052e2b;
    }`;

const BUTTON_CSS_AMBER = `
    button {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      background: #f59e0b;
      color: #1f1300;
    }`;

function pairingPageHtml(title: string, body: string, extraCss = "", afterBody = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #111827;
      color: #f3f4f6;
      padding: 24px;
    }
    .pairing-card {
      width: min(100%, 400px);
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      margin: 0 0 16px;
      color: #d1d5db;
      line-height: 1.5;
    }${extraCss}
  </style>
</head>
<body>
  <main class="pairing-card">${body}
  </main>${afterBody}
</body>
</html>`;
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
