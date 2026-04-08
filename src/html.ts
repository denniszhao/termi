export function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Termi</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
    #terminal { width: 100%; height: 100%; }
    #status {
      position: fixed; top: 0; left: 0; right: 0;
      padding: 4px 8px; font-family: monospace; font-size: 12px;
      color: #888; background: rgba(0,0,0,0.8); z-index: 10;
      text-align: center; transition: opacity 0.3s;
    }
    #status.connected { opacity: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="status">Connecting...</div>
  <div id="terminal"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const token = new URLSearchParams(location.search).get("t");
    const WS_URL = proto + "//" + location.host + "/?t=" + token;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      theme: { background: "#1e1e1e" },
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById("terminal"));
    fitAddon.fit();

    const statusEl = document.getElementById("status");
    let ws;

    function sendResize() {
      const dims = fitAddon.proposeDimensions();
      if (dims && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    }

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        statusEl.textContent = "Connected";
        statusEl.classList.add("connected");
        sendResize();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "data") term.write(msg.data);
      };
      ws.onclose = () => {
        statusEl.textContent = "Disconnected. Reconnecting...";
        statusEl.classList.remove("connected");
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    }

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    window.addEventListener("resize", () => {
      fitAddon.fit();
      sendResize();
    });

    connect();
  </script>
</body>
</html>`;
}
