export interface TrustedDevice {
  id: string;
  secretHash: string;
  createdAt: string;
  lastSeenAt: string;
  label?: string;
}

export interface TermiSavedConfig {
  tunnel: {
    id: string;
    name: string;
    domain: string;
  };
  trustedDevices: TrustedDevice[];
  mobileOnboardingSeen: boolean;
}

export type WsClientMessage =
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number };
