/**
 * Hostile bridge input: a malicious or buggy bridge must not be able to crash
 * the client, surface phantom events, or corrupt an active session. The crypto
 * layer rejects tampered payloads; these tests prove the connector/transport
 * plumbing above it ignores every malformed frame shape end-to-end.
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

// oxlint-disable-next-line typescript/no-explicit-any -- legacy connector event API is untyped
function nextEvent(connector: WalletConnect, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy connector event API is untyped
    connector.on(event, (error: Error | null, payload: any) => {
      if (error) reject(error);
      else resolve(payload);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("hostile bridge input", () => {
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

  it("ignores malformed and tampered frames without disturbing the session", async () => {
    // establish a real session
    const dapp = new WalletConnect({ bridge: bridge.url, clientMeta: CLIENT_META });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 1 });

    const wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    await nextEvent(wallet, "session_request");
    const connected = nextEvent(dapp, "connect");
    wallet.approveSession({ accounts: ["ACCOUNT1"], chainId: 1 });
    await connected;

    // capture a genuine encrypted frame to tamper with
    const realFrame = bridge.messages.find(m => m.type === "pub" && m.payload.includes('"data"'));
    expect(realFrame).toBeDefined();
    const tamperedPayload = JSON.stringify({
      ...JSON.parse(realFrame!.payload),
      data: "00".repeat(64), // valid hex, wrong ciphertext → HMAC fails → decrypt null
    });

    // record every event the wallet emits from here on
    const observed: string[] = [];
    for (const event of ["call_request", "session_update", "disconnect", "error"]) {
      // oxlint-disable-next-line typescript/no-explicit-any -- event payloads vary
      wallet.on(event, (_e: Error | null, _p: any) => observed.push(event));
    }
    const walletTopic = wallet.clientId;

    // 1. payload that is not JSON
    bridge.injectFrame(walletTopic, "not-json{{{");
    // 2. valid JSON but not an encryption payload (decrypt → null, ignored)
    bridge.injectFrame(walletTopic, '{"hello":"world"}');
    // 3. tampered ciphertext (HMAC verification fails → ignored)
    bridge.injectFrame(walletTopic, tamperedPayload);
    // 4. frame on a topic the wallet never subscribed to
    bridge.injectFrame("unrelated-topic", realFrame!.payload);

    await delay(300);
    expect(observed).toEqual([]);

    // session still fully functional after the garbage
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({ method: "algo_signTxn", params: [[]] });
    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: ["still-works"] });
    expect(await resultPromise).toEqual(["still-works"]);
    expect(wallet.connected).toBe(true);
  }, 15_000);
});
