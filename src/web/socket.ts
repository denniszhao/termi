export interface TerminalSocketController {
  connect(): void;
  sendData(data: string): void;
  sendResize(cols: number, rows: number): void;
}

interface CreateTerminalSocketOptions {
  wsUrl: string;
  statusEl: HTMLElement;
  onData: (data: string) => void;
  onOpen: () => void;
}

export function createTerminalSocket(
  options: CreateTerminalSocketOptions,
): TerminalSocketController {
  const { wsUrl, statusEl, onData, onOpen } = options;
  let ws: WebSocket | undefined;
  let reconnectTimer: number | undefined;

  function scheduleReconnect(): void {
    if (reconnectTimer !== undefined) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, 2000);
  }

  function connect(): void {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      statusEl.textContent = "Connected";
      statusEl.classList.add("connected");
      onOpen();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { type?: string; data?: string };
      if (msg.type === "data" && msg.data) {
        onData(msg.data);
      }
    };

    ws.onclose = () => {
      statusEl.textContent = "Disconnected. Reconnecting...";
      statusEl.classList.remove("connected");
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  return {
    connect,
    sendData: (data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    },
    sendResize: (cols, rows) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
  };
}

