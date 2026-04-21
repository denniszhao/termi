export interface TerminalSocketController {
  connect(): void;
  sendData(data: string): void;
  sendResize(cols: number, rows: number): void;
}

export type TerminalSocketState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface CreateTerminalSocketOptions {
  wsUrl: string;
  onSessionEnded?: () => void;
  onSessionReplaced?: () => void;
  onSessionReopened?: () => void;
  onData: (data: string) => void;
  onOpen: () => void;
  onStateChange: (state: TerminalSocketState) => void;
}

const SESSION_ENDED_CLOSE_CODE = 4000;
const SESSION_REPLACED_CLOSE_CODE = 4001;
const SESSION_REOPENED_CLOSE_CODE = 4002;
const SESSION_ACTIVE_ELSEWHERE_CLOSE_CODE = 4003;

export function createTerminalSocket(
  options: CreateTerminalSocketOptions,
): TerminalSocketController {
  const {
    wsUrl,
    onData,
    onOpen,
    onSessionEnded,
    onSessionReplaced,
    onSessionReopened,
    onStateChange,
  } = options;
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
      ws = undefined;
      onStateChange("disconnected");
      if (event.code === SESSION_ENDED_CLOSE_CODE) {
        onSessionEnded?.();
        return;
      }
      if (event.code === SESSION_REPLACED_CLOSE_CODE || event.code === SESSION_ACTIVE_ELSEWHERE_CLOSE_CODE) {
        onSessionReplaced?.();
        return;
      }
      if (event.code === SESSION_REOPENED_CLOSE_CODE) {
        onSessionReopened?.();
        return;
      }
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
