export function getHtml(): string {
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
  <div id="terminal-brand"><span id="terminal-brand-logo">🍉</span><span id="terminal-brand-wordmark">termi</span></div>
  <div id="status">Connecting...</div>
  <div id="terminal"></div>
  <div id="trackpad-hint">&larr; &rarr; &uarr; &darr;</div>
  <button id="kb-toggle" type="button">&#9000;</button>
  <div id="keyboard"></div>
  <script src="/app.js"></script>
</body>
</html>`;
}
