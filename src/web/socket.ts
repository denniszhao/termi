export interface TerminalSocketController {
  connect(): void;
  sendData(data: string): void;
  sendResize(cols: number, rows: number): void;
}

export type TerminalSocketState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface CreateTerminalSocketOptions {
  wsUrl: string;
  onData: (data: string) => void;
  onOpen: () => void;
  onStateChange: (state: TerminalSocketState) => void;
}

export function createTerminalSocket(
  options: CreateTerminalSocketOptions,
): TerminalSocketController {
  const { wsUrl, onData, onOpen, onStateChange } = options;
  let ws: WebSocket | undefined;
  let reconnectTimer: number | undefined;

  function scheduleReconnect(): void {
    if (reconnectTimer !== undefined) {
      return;
    }
    onStateChange("reconnecting");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, 2000);
  }

  function connect(): void {
    onStateChange(reconnectTimer === undefined ? "connecting" : "reconnecting");
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      onStateChange("connected");
      onOpen();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { type?: string; data?: string };
      if (msg.type === "data" && msg.data) {
        onData(msg.data);
      }
    };

    ws.onclose = () => {
      onStateChange("disconnected");
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
