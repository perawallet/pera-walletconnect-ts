/**
 * Push-server registration: a wallet constructed with pushServerOpts registers
 * its clientId topic with the push server after the session connects. The
 * registration runs inside the "connect" event callback, so a failed
 * registration cannot reject anything awaitable — the strongest observable
 * contract is the fetch call itself plus session survival, which is what these
 * tests assert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WalletConnect from "../src";
import { MockBridge } from "./mock-bridge";

const CLIENT_META = {
  description: "test dapp",
  url: "https://dapp.example",
  icons: [],
  name: "Test Dapp",
};

const PUSH_OPTS = {
  url: "https://push.example",
  type: "fcm",
  token: "device-token",
  language: "en",
  peerMeta: true,
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

describe("push server registration", () => {
  let bridge: MockBridge;
  const connectors: WalletConnect[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
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

  async function connectWithPush(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);

    const dapp = new WalletConnect({ bridge: bridge.url, clientMeta: CLIENT_META });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 1 });

    const wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META }, PUSH_OPTS);
    connectors.push(wallet);
    await new Promise<void>(resolve => wallet.on("session_request", () => resolve()));
    wallet.approveSession({ accounts: ["ACCOUNT1"], chainId: 1 });
    await new Promise<void>(resolve => dapp.on("connect", () => resolve()));
    return { dapp, wallet };
  }

  it("POSTs the subscription to <url>/new with topic and peer name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });
    const { wallet } = await connectWithPush(fetchMock);

    await waitFor(() => (fetchMock.mock.calls.length > 0 ? true : undefined));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://push.example/new");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      bridge: bridge.url,
      topic: wallet.clientId,
      type: "fcm",
      token: "device-token",
      language: "en",
      peerName: "Test Dapp", // peerMeta: true pulls the dapp's name
    });
  }, 15_000);

  it("a failed registration does not break the session", async () => {
    // Legacy behavior preserved verbatim: the registration failure throws
    // inside an async "connect" event callback, surfacing as an unhandled
    // rejection. Capture it here so it is a documented contract, not noise.
    const rejections: Error[] = [];
    const captureRejection = (reason: unknown) => {
      if (reason instanceof Error && reason.message.includes("Push Server")) {
        rejections.push(reason);
      } else {
        throw reason;
      }
    };
    process.on("unhandledRejection", captureRejection);
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    });
    try {
      const { dapp, wallet } = await connectWithPush(fetchMock);

      await waitFor(() => (fetchMock.mock.calls.length > 0 ? true : undefined));
      await waitFor(() => (rejections.length > 0 ? true : undefined));
      expect(rejections[0]!.message).toBe("Failed to register in Push Server");

      // the registration failure is contained to the event callback; the
      // session itself keeps working
      const callRequest = new Promise<{ id: number }>(resolve =>
        // oxlint-disable-next-line typescript/no-explicit-any -- legacy event API
        wallet.on("call_request", (_e: Error | null, p: any) => resolve(p)),
      );
      const resultPromise = dapp.sendCustomRequest({ method: "algo_signTxn", params: [[]] });
      const call = await callRequest;
      wallet.approveRequest({ id: call.id, result: ["ok"] });
      expect(await resultPromise).toEqual(["ok"]);
      expect(wallet.connected).toBe(true);
    } finally {
      process.off("unhandledRejection", captureRejection);
    }
  }, 15_000);
});
