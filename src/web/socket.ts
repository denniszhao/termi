export interface TerminalSocketController {
  connect(): void;
  sendData(data: string): void;
  sendResize(cols: number, rows: number): void;
}

export type TerminalSocketState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface CreateTerminalSocketOptions {
  wsUrl: string;
  onSessionReplaced?: () => void;
  onData: (data: string) => void;
  onOpen: () => void;
  onStateChange: (state: TerminalSocketState) => void;
}

export function createTerminalSocket(
  options: CreateTerminalSocketOptions,
): TerminalSocketController {
  const { wsUrl, onData, onOpen, onSessionReplaced, onStateChange } = options;
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
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) {
        return;
      }
      onStateChange("connected");
      onOpen();
    };

    socket.onmessage = (event) => {
      if (ws !== socket) {
        return;
      }
      const msg = JSON.parse(String(event.data)) as { type?: string; data?: string };
      if (msg.type === "data" && msg.data) {
        onData(msg.data);
      }
    };

    socket.onclose = (event) => {
      if (ws !== socket) {
        return;
      }
      if (event.code === 4001) {
        ws = undefined;
        onStateChange("disconnected");
        onSessionReplaced?.();
        return;
      }
      ws = undefined;
      onStateChange("disconnected");
      scheduleReconnect();
    };

    socket.onerror = () => {
      if (ws !== socket) {
        return;
      }
      socket.close();
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
