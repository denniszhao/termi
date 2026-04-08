declare module "qrcode-terminal" {
  export function generate(
    text: string,
    opts?: { small?: boolean },
    cb?: (qr: string) => void,
  ): void;
}

export interface TermiConfig {
  mode: "tunnel" | "local";
  port: number;
  shell: string;
  token: string;
}

export interface WsClientMessage {
  type: "data" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}
