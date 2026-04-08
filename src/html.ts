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
  <div id="terminal-brand">
    <span id="terminal-brand-logo">🍉</span><span id="terminal-brand-wordmark">termi</span><span id="status"><span id="status-dot"></span><span id="status-text">Connecting</span></span>
  </div>
  <div id="terminal"></div>
  <div id="trackpad-hint">&larr; &rarr; &uarr; &darr;</div>
  <button id="kb-toggle" type="button">&#9000;</button>
  <div id="keyboard"></div>
  <div id="onboarding-backdrop">
    <div id="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">Quick tour</h2>
      <ol id="onboarding-list">
        <li>On mobile, press the keyboard button to switch between virtual and OS-based keyboards.</li>
        <li>Hold and drag on the terminal to move the text cursor.</li>
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

export function getPairingHtml(error?: string): string {
  const errorBlock = error
    ? `<p class="pairing-error">${escapeHtml(error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Pair Termi</title>
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
      width: min(100%, 360px);
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
    }
    form {
      display: grid;
      gap: 12px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #4b5563;
      border-radius: 12px;
      padding: 14px 16px;
      font: inherit;
      font-size: 22px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      text-align: center;
      background: #111827;
      color: #f9fafb;
    }
    button {
      border: 0;
      border-radius: 12px;
      padding: 14px 16px;
      font: inherit;
      font-weight: 700;
      background: #10b981;
      color: #052e2b;
    }
    .pairing-error {
      color: #fca5a5;
    }
  </style>
</head>
<body>
  <main class="pairing-card">
    <h1>Pair This Browser</h1>
    <p>Enter the 6-character pairing code shown in your local terminal.</p>
    ${errorBlock}
    <form method="post" action="/pair">
      <input
        name="code"
        type="text"
        autofocus
        inputmode="text"
        maxlength="6"
        autocapitalize="characters"
        autocomplete="one-time-code"
        placeholder="ABC123"
        required
      >
      <button type="submit">Pair Browser</button>
    </form>
  </main>
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
