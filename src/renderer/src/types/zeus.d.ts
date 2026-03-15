interface ZeusAPI {
  getStatus: () => Promise<{
    powerBlock: boolean;
    websocket: boolean;
    tunnel: string | null;
  }>;
  togglePower: () => Promise<boolean>;
}

declare global {
  interface Window {
    zeus: ZeusAPI;
  }
}

export {};
