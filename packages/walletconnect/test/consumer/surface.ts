// Compile-only contract test: the exact API surface pera-connect (../connect)
// uses. If this file stops compiling, pera-connect breaks.
import WalletConnect from "@perawallet/walletconnect";
import type { IWalletConnectSession } from "@perawallet/walletconnect/types";

export function peraConnectSurface(): void {
  const connector = new WalletConnect({
    bridge: "https://bridge.example.org",
    qrcodeModal: {
      open: (_uri: string, _cb: unknown, _opts?: unknown) => undefined,
      close: () => undefined,
    },
  });

  void new WalletConnect({ bridge: "https://bridge.example.org" });

  void connector.createSession({ chainId: 4160 });
  void connector.killSession();
  void connector.sendCustomRequest(
    { method: "algo_signTxn", params: [] },
    { forcePushNotification: true },
  );
  connector.on("connect", (error: Error | null, payload: unknown) => {
    void error;
    void payload;
  });

  const connected: boolean = connector.connected;
  const accounts: string[] = connector.accounts;
  const bridge: string = connector.bridge;
  void connected;
  void accounts;
  void bridge;

  const session: IWalletConnectSession = connector.session;
  void session;
}
