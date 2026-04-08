export interface TermiConfig {
  mode: "tunnel" | "persistent";
  port: number;
  shell: string;
  token?: string;
}

export interface TrustedDevice {
  id: string;
  secretHash: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface TermiSavedConfig {
  tunnel: {
    id: string;
    name: string;
    domain: string;
  };
  trustedDevices: TrustedDevice[];
}

export interface WsClientMessage {
  type: "data" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}
