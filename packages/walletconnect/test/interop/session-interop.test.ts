/* oxlint-disable typescript/no-explicit-any -- mixes the untyped legacy @walletconnect/client with the new client */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line import/no-extraneous-dependencies -- interop oracle
import LegacyWalletConnect from "@walletconnect/client";
import WalletConnect from "../../src";
import { MockBridge } from "../mock-bridge";

const CLIENT_META = {
  description: "test wallet",
  url: "https://pera.test",
  icons: [],
  name: "Pera Test",
};

function nextEvent(connector: any, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    connector.on(event, (error: Error | null, payload: any) => {
      if (error) reject(error);
      else resolve(payload);
    });
  });
}

describe("session interop: legacy dapp ↔ new wallet", () => {
  let bridge: MockBridge;
  const connectors: any[] = [];

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

  it("full lifecycle: connect, custom request, update, kill", async () => {
    // 1. legacy dapp creates a session
    const dapp = new LegacyWalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: { open: () => undefined, close: () => undefined },
    });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 4160 });
    expect(dapp.uri).toMatch(/^wc:/);

    // 2. new wallet joins from the URI and receives the session request
    const wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    const sessionRequest = nextEvent(wallet, "session_request");
    const connected = nextEvent(dapp, "connect");
    const requestPayload = await sessionRequest;
    expect(requestPayload.params[0].peerMeta.name).toBe("Pera Test");
    expect(requestPayload.params[0].chainId).toBe(4160);

    // 3. wallet approves; dapp sees connect with accounts
    wallet.approveSession({ accounts: ["PERAACCOUNT1"], chainId: 4160 });
    const connectPayload = await connected;
    expect(connectPayload.params[0].accounts).toEqual(["PERAACCOUNT1"]);
    expect(dapp.connected).toBe(true);
    expect(wallet.connected).toBe(true);

    // 4. dapp sends a custom request (pera-connect's exact call shape)
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest(
      { method: "algo_signTxn", params: [[{ txn: "b64" }]] },
      { forcePushNotification: true },
    );
    const call = await callRequest;
    expect(call.method).toBe("algo_signTxn");
    wallet.approveRequest({ id: call.id, result: ["signed"] });
    expect(await resultPromise).toEqual(["signed"]);

    // 5. wallet pushes a session update
    const updated = nextEvent(dapp, "session_update");
    wallet.updateSession({ accounts: ["PERAACCOUNT2"], chainId: 4160 });
    expect((await updated).params[0].accounts).toEqual(["PERAACCOUNT2"]);

    // 6. dapp kills the session; wallet sees disconnect
    const disconnected = nextEvent(wallet, "disconnect");
    await dapp.killSession();
    await disconnected;
    expect(wallet.connected).toBe(false);
  }, 30_000);
});

describe("session interop: new dapp ↔ legacy wallet", () => {
  let bridge: MockBridge;
  const connectors: any[] = [];

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

  it("full lifecycle in the reverse orientation", async () => {
    const dapp = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: { open: () => undefined, close: () => undefined },
    });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 4160 });

    const wallet = new LegacyWalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    const requestPayload = await nextEvent(wallet, "session_request");
    expect(requestPayload.params[0].chainId).toBe(4160);

    const connected = nextEvent(dapp, "connect");
    wallet.approveSession({ accounts: ["LEGACYACCOUNT"], chainId: 4160 });
    expect((await connected).params[0].accounts).toEqual(["LEGACYACCOUNT"]);
    expect(dapp.connected).toBe(true);
    expect(wallet.connected).toBe(true);

    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({ method: "algo_signTxn", params: [[]] });
    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: ["ok"] });
    expect(await resultPromise).toEqual(["ok"]);

    // legacy wallet pushes a session update; the new dapp must consume the
    // legacy-encrypted wc_sessionUpdate
    const updated = nextEvent(dapp, "session_update");
    wallet.updateSession({ accounts: ["LEGACYACCOUNT2"], chainId: 4160 });
    expect((await updated).params[0].accounts).toEqual(["LEGACYACCOUNT2"]);

    const disconnected = nextEvent(wallet, "disconnect");
    await dapp.killSession();
    await disconnected;
    expect(dapp.connected).toBe(false);
  }, 30_000);
});
