export interface TermiConfig {
  mode: "tunnel" | "persistent";
  port: number;
  shell: string;
  token: string;
}

export interface TermiSavedConfig {
  tunnel: {
    id: string;
    name: string;
    domain: string;
  };
}

export interface WsClientMessage {
  type: "data" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}
