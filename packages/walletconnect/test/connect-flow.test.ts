/**
 * The dapp-side connect() promise API: resolves with the session status when
 * the wallet approves, rejects when the user closes the QR modal. This is the
 * entry point web dapps use (pera-connect wires its own modal through it).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WalletConnect from "../src";
import { MockBridge } from "./mock-bridge";

const CLIENT_META = {
  description: "test",
  url: "https://test.example",
  icons: [],
  name: "Test",
};

function waitFor<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const result = check();
      if (result !== undefined) {
        clearInterval(interval);
        resolve(result);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 10);
  });
}

describe("connect() promise flow", () => {
  let bridge: MockBridge;
  const connectors: WalletConnect[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    for (const c of connectors) {
      try {
        c.transportClose();
      } catch {
        /* already closed */
      }
    }
    connectors.length = 0;
    await bridge.close();
  });

  it("resolves with the session status when the wallet approves", async () => {
    let displayedUri = "";
    const dapp = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: {
        open: (uri: string) => {
          displayedUri = uri;
        },
        close: () => undefined,
      },
    });
    connectors.push(dapp);

    const statusPromise = dapp.connect({ chainId: 1 });

    // the modal receives a wc: uri (async: key generation precedes display_uri);
    // a wallet joins from it and approves
    await waitFor(() => (displayedUri ? true : undefined));
    expect(displayedUri).toMatch(/^wc:/);
    const wallet = new WalletConnect({ uri: displayedUri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    await new Promise<void>(resolve => wallet.on("session_request", () => resolve()));
    wallet.approveSession({ accounts: ["ACCOUNT1"], chainId: 1 });

    const status = await statusPromise;
    expect(status.accounts).toEqual(["ACCOUNT1"]);
    expect(status.chainId).toBe(1);
    expect(dapp.connected).toBe(true);
  }, 15_000);

  it("rejects when the user closes the QR modal", async () => {
    let modalCloseCb: (() => void) | undefined;
    const dapp = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: {
        open: (_uri: string, cb: unknown) => {
          modalCloseCb = cb as () => void;
        },
        close: () => undefined,
      },
    });
    connectors.push(dapp);

    const statusPromise = dapp.connect({ chainId: 1 });
    await waitFor(() => modalCloseCb);
    modalCloseCb!();

    await expect(statusPromise).rejects.toThrowError(/QRCode Modal/);
    expect(dapp.connected).toBe(false);
  }, 15_000);
});
