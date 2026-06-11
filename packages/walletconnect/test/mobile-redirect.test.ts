/**
 * Mobile deep-link redirect: on a mobile browser, sending a signing request
 * redirects to the wallet app the user previously chose (persisted under
 * WALLETCONNECT_DEEPLINK_CHOICE). Non-signing requests must not redirect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WalletConnect from "../src";
import { MockBridge } from "./mock-bridge";
import { mobileLinkChoiceKey } from "../src/browser/mobile";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const CLIENT_META = {
  description: "test",
  url: "https://test.example",
  icons: [],
  name: "Test",
};

// oxlint-disable-next-line typescript/no-explicit-any -- legacy connector event API is untyped
function nextEvent(connector: WalletConnect, event: string): Promise<any> {
  return new Promise(resolve => {
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy connector event API is untyped
    connector.on(event, (_e: Error | null, p: any) => resolve(p));
  });
}

describe("mobile deep-link redirect on signing requests", () => {
  let bridge: MockBridge;
  const connectors: WalletConnect[] = [];
  let store: Map<string, string>;
  let location: { href: string };

  beforeEach(async () => {
    bridge = await MockBridge.start();
    store = new Map([[mobileLinkChoiceKey, JSON.stringify({ name: "Pera", href: "pera://wc" })]]);
    location = { href: "https://dapp.example" };
    vi.stubGlobal("window", {
      navigator: { userAgent: ANDROID_UA, maxTouchPoints: 5 },
      location,
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA, maxTouchPoints: 5 });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
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

  async function makePair() {
    const dapp = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      storageId: "wc-dapp",
    });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 1 });
    const wallet = new WalletConnect({
      uri: dapp.uri,
      clientMeta: CLIENT_META,
      storageId: "wc-wallet",
    });
    connectors.push(wallet);
    await nextEvent(wallet, "session_request");
    const connected = nextEvent(dapp, "connect");
    wallet.approveSession({ accounts: ["ACCOUNT1"], chainId: 1 });
    await connected;
    return { dapp, wallet };
  }

  it("redirects to the chosen wallet deep link for signing methods", async () => {
    const { dapp, wallet } = await makePair();

    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "eth_sign",
      params: ["0x" + "ab".repeat(20), "0x68656c6c6f"],
    });
    expect(location.href).toBe("pera://wc");

    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: "0xsigned" });
    expect(await resultPromise).toBe("0xsigned");
  }, 15_000);

  it("does not redirect for non-signing methods", async () => {
    const { dapp, wallet } = await makePair();

    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({ method: "eth_getBalance", params: [] });
    expect(location.href).toBe("https://dapp.example");

    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: "0x0" });
    expect(await resultPromise).toBe("0x0");
  }, 15_000);
});
