/**
 * Targeted unit tests for connector convenience methods, error throws,
 * approveRequest / rejectRequest, unsafeSend, rejectSession, connect(),
 * _registerPushServer validation, and sendCustomRequest short-circuits.
 *
 * Pattern: two-client MockBridge (dapp sends → wallet responds) for the
 * round-trip tests; simple disconnected-state assertions for throw tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WalletConnect from "../src";
import { MockBridge } from "./mock-bridge";
import {
  ERROR_SESSION_DISCONNECTED,
  ERROR_SESSION_CONNECTED,
  ERROR_MISSING_RESULT,
  ERROR_MISSING_ERROR,
  ERROR_QRCODE_MODAL_NOT_PROVIDED,
} from "../src/core/errors";

// ------------------------------------------------------------------ helpers

const CLIENT_META = {
  description: "test",
  url: "https://test.example",
  icons: [],
  name: "Test",
};

// Valid 40-hex-char Ethereum addresses (lowercase passes isValidAddress)
const ADDR_FROM = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const ADDR_TO = "0xcafecafecafecafecafecafecafecafecafecafe";
const ADDR_ACC = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/** Resolves on the first emission of `event` on `connector`. */
// oxlint-disable-next-line typescript/no-explicit-any -- event payload shape varies per event
function nextEvent(connector: WalletConnect, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy connector event API is untyped
    connector.on(event, (error: Error | null, payload: any) => {
      if (error) reject(error);
      else resolve(payload);
    });
  });
}

/** Build a connected dapp + wallet pair over a live MockBridge. */
async function makePair(bridge: MockBridge) {
  const dapp = new WalletConnect({
    bridge: bridge.url,
    clientMeta: CLIENT_META,
  });

  // Wallet joins from dapp URI
  await dapp.createSession({ chainId: 1 });
  const wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });

  const sessionRequest = nextEvent(wallet, "session_request");
  const connected = nextEvent(dapp, "connect");

  // wallet approves
  await sessionRequest;
  wallet.approveSession({ accounts: [ADDR_ACC], chainId: 1 });
  await connected;

  return { dapp, wallet };
}

// ------------------------------------------------------------------ suites

describe("disconnected-state throws", () => {
  let wc: WalletConnect;
  let bridge: MockBridge;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    wc = new WalletConnect({ bridge: bridge.url, clientMeta: CLIENT_META });
  });
  afterEach(async () => {
    wc.transportClose();
    await bridge.close();
  });

  it("sendTransaction throws when disconnected", async () => {
    await expect(
      wc.sendTransaction({ from: ADDR_FROM, to: ADDR_TO, value: "0x0" }),
    ).rejects.toThrow(ERROR_SESSION_DISCONNECTED);
  });

  it("signTransaction throws when disconnected", async () => {
    await expect(
      wc.signTransaction({ from: ADDR_FROM, to: ADDR_TO, value: "0x0" }),
    ).rejects.toThrow(ERROR_SESSION_DISCONNECTED);
  });

  it("signMessage throws when disconnected", async () => {
    await expect(wc.signMessage(["0x1234", ADDR_ACC])).rejects.toThrow(ERROR_SESSION_DISCONNECTED);
  });

  it("signPersonalMessage throws when disconnected", async () => {
    await expect(wc.signPersonalMessage(["0xMSG", ADDR_ACC])).rejects.toThrow(
      ERROR_SESSION_DISCONNECTED,
    );
  });

  it("signTypedData throws when disconnected", async () => {
    await expect(wc.signTypedData([ADDR_ACC, { types: {} }])).rejects.toThrow(
      ERROR_SESSION_DISCONNECTED,
    );
  });

  it("updateChain throws when disconnected", async () => {
    await expect(
      wc.updateChain({
        chainId: 1,
        networkId: 1,
        rpcUrl: "https://rpc.example",
        nativeCurrency: { name: "ETH", symbol: "ETH" },
      }),
    ).rejects.toThrow("Session currently disconnected");
  });

  it("sendCustomRequest throws when disconnected", async () => {
    await expect(wc.sendCustomRequest({ method: "eth_getBalance", params: [] })).rejects.toThrow(
      ERROR_SESSION_DISCONNECTED,
    );
  });
});

describe("connect() without qrcodeModal throws", () => {
  let wc: WalletConnect;
  let bridge: MockBridge;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    // no qrcodeModal provided
    wc = new WalletConnect({ bridge: bridge.url, clientMeta: CLIENT_META });
  });
  afterEach(async () => {
    wc.transportClose();
    await bridge.close();
  });

  it("throws ERROR_QRCODE_MODAL_NOT_PROVIDED", async () => {
    await expect(wc.connect()).rejects.toThrow(ERROR_QRCODE_MODAL_NOT_PROVIDED);
  });
});

describe("connect() when already connected returns current session", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("returns chainId and accounts immediately", async () => {
    const modal = { open: vi.fn(), close: vi.fn() };
    // We need a new connector that is already connected by injecting session
    const dapp2 = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      session: dapp.session,
      qrcodeModal: modal,
    });
    const status = await dapp2.connect();
    expect(status.chainId).toBe(1);
    expect(status.accounts).toEqual([ADDR_ACC]);
    dapp2.transportClose();
  });
});

describe("rejectSession", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    dapp = new WalletConnect({ bridge: bridge.url, clientMeta: CLIENT_META });
    await dapp.createSession({ chainId: 1 });
    wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    // wait for wallet to receive session_request
    await nextEvent(wallet, "session_request");
  });
  afterEach(async () => {
    try {
      dapp.transportClose();
    } catch {
      /* ignore */
    }
    try {
      wallet.transportClose();
    } catch {
      /* ignore */
    }
    await bridge.close();
  });

  it("rejectSession sends disconnect and fires disconnect event on wallet", async () => {
    const disconnected = nextEvent(dapp, "disconnect");
    wallet.rejectSession({ message: "user rejected" });
    const payload = await disconnected;
    expect(payload.params[0].message).toBe("user rejected");
  });

  it("rejectSession uses default message when none supplied", async () => {
    const disconnected = nextEvent(dapp, "disconnect");
    wallet.rejectSession();
    const payload = await disconnected;
    expect(payload.params[0].message).toBeTruthy();
  });

  it("rejectSession throws when already connected", async () => {
    // connect first
    wallet.approveSession({ accounts: ["0xACC"], chainId: 1 });
    await nextEvent(dapp, "connect");
    expect(() => wallet.rejectSession()).toThrow(ERROR_SESSION_CONNECTED);
  });
});

describe("approveRequest / rejectRequest", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("approveRequest resolves the caller promise", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "algo_signTxn",
      params: [[]],
    });
    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: "signed" });
    await expect(resultPromise).resolves.toBe("signed");
  });

  it("approveRequest throws ERROR_MISSING_RESULT when result is absent", () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- intentionally malformed input
    expect(() => wallet.approveRequest({ id: 1 } as any)).toThrow(ERROR_MISSING_RESULT);
  });

  it("rejectRequest rejects the caller promise", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "algo_signTxn",
      params: [[]],
    });
    const call = await callRequest;
    wallet.rejectRequest({ id: call.id, error: { code: -32_000, message: "denied" } });
    await expect(resultPromise).rejects.toMatchObject({ message: "denied" });
  });

  it("rejectRequest throws ERROR_MISSING_ERROR when error is absent", () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- intentionally malformed input
    expect(() => wallet.rejectRequest({ id: 1 } as any)).toThrow(ERROR_MISSING_ERROR);
  });
});

describe("unsafeSend", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("resolves with the raw response payload when request is approved", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const rawPromise = dapp.unsafeSend({
      id: 9999,
      jsonrpc: "2.0",
      method: "algo_signTxn",
      params: [[]],
    });
    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: "raw-result" });
    const raw = await rawPromise;
    // unsafeSend resolves with the full IJsonRpcResponseSuccess payload
    expect((raw as { result?: unknown }).result).toBe("raw-result");
  });

  it("resolves call_request_sent event when called", async () => {
    const sentEvent = nextEvent(dapp, "call_request_sent");
    dapp.unsafeSend({
      id: 8888,
      jsonrpc: "2.0",
      method: "algo_signTxn",
      params: [[]],
    });
    const payload = await sentEvent;
    expect(payload.params[0].request.method).toBe("algo_signTxn");
  });
});

describe("sendCustomRequest short-circuit: eth_accounts and eth_chainId", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("eth_accounts returns session accounts without bridge round-trip", async () => {
    const result = await dapp.sendCustomRequest({ method: "eth_accounts" });
    expect(result).toEqual([ADDR_ACC]);
  });

  it("eth_chainId returns hex-encoded chainId without bridge round-trip", async () => {
    const result = await dapp.sendCustomRequest({ method: "eth_chainId" });
    // convertNumberToHex(1) → "0x01"
    expect(typeof result).toBe("string");
    expect(result.startsWith("0x")).toBe(true);
    expect(parseInt(result, 16)).toBe(1);
  });
});

describe("sendCustomRequest: eth_sendTransaction param parsing", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("parses transaction params before sending eth_sendTransaction", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "eth_sendTransaction",
      params: [{ from: ADDR_FROM, to: ADDR_TO, value: 1000 }],
    });
    const call = await callRequest;
    // value should be hex-encoded by parseTransactionData
    expect(call.params[0].value).toMatch(/^0x/);
    wallet.approveRequest({ id: call.id, result: "0xTXHASH" });
    await expect(resultPromise).resolves.toBe("0xTXHASH");
  });

  it("parses transaction params before sending eth_signTransaction", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "eth_signTransaction",
      params: [{ from: ADDR_FROM, to: ADDR_TO, value: 2000 }],
    });
    const call = await callRequest;
    expect(call.params[0].value).toMatch(/^0x/);
    wallet.approveRequest({ id: call.id, result: "0xSIGNED" });
    await expect(resultPromise).resolves.toBe("0xSIGNED");
  });

  it("parses personal_sign params before sending", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({
      method: "personal_sign",
      params: ["hello world", "0xACC"],
    });
    const call = await callRequest;
    // parsePersonalSign converts the message string to hex
    expect(call.method).toBe("personal_sign");
    wallet.approveRequest({ id: call.id, result: "0xSIG" });
    await expect(resultPromise).resolves.toBe("0xSIG");
  });
});

describe("convenience method round-trips via MockBridge", () => {
  let bridge: MockBridge;
  let dapp: WalletConnect;
  let wallet: WalletConnect;

  beforeEach(async () => {
    bridge = await MockBridge.start();
    ({ dapp, wallet } = await makePair(bridge));
  });
  afterEach(async () => {
    dapp.transportClose();
    wallet.transportClose();
    await bridge.close();
  });

  it("sendTransaction → wallet sees eth_sendTransaction", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.sendTransaction({ from: ADDR_FROM, to: ADDR_TO, value: "0x0" });
    const call = await callRequest;
    expect(call.method).toBe("eth_sendTransaction");
    wallet.approveRequest({ id: call.id, result: "0xTX" });
    await expect(result).resolves.toBe("0xTX");
  });

  it("signTransaction → wallet sees eth_signTransaction", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.signTransaction({ from: ADDR_FROM, to: ADDR_TO, value: "0x0" });
    const call = await callRequest;
    expect(call.method).toBe("eth_signTransaction");
    wallet.approveRequest({ id: call.id, result: "0xSIGNED" });
    await expect(result).resolves.toBe("0xSIGNED");
  });

  it("signMessage → wallet sees eth_sign", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.signMessage([ADDR_ACC, "0xDATA"]);
    const call = await callRequest;
    expect(call.method).toBe("eth_sign");
    wallet.approveRequest({ id: call.id, result: "0xSIG" });
    await expect(result).resolves.toBe("0xSIG");
  });

  it("signPersonalMessage → wallet sees personal_sign", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.signPersonalMessage(["hello", ADDR_ACC]);
    const call = await callRequest;
    expect(call.method).toBe("personal_sign");
    wallet.approveRequest({ id: call.id, result: "0xSIG" });
    await expect(result).resolves.toBe("0xSIG");
  });

  it("signTypedData → wallet sees eth_signTypedData", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.signTypedData([
      ADDR_ACC,
      { types: {}, primaryType: "Test", domain: {}, message: {} },
    ]);
    const call = await callRequest;
    expect(call.method).toBe("eth_signTypedData");
    wallet.approveRequest({ id: call.id, result: "0xSIG" });
    await expect(result).resolves.toBe("0xSIG");
  });

  it("updateChain → wallet sees wallet_updateChain", async () => {
    const callRequest = nextEvent(wallet, "call_request");
    const result = dapp.updateChain({
      chainId: 137,
      networkId: 137,
      rpcUrl: "https://polygon.rpc",
      nativeCurrency: { name: "MATIC", symbol: "MATIC" },
    });
    const call = await callRequest;
    expect(call.method).toBe("wallet_updateChain");
    wallet.approveRequest({ id: call.id, result: true });
    await expect(result).resolves.toBe(true);
  });
});

describe("_registerPushServer validation throws", () => {
  let bridge: MockBridge;

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    await bridge.close();
  });

  it("throws when pushServerOpts.url is missing", () => {
    expect(
      () =>
        new WalletConnect(
          { bridge: bridge.url, clientMeta: CLIENT_META },
          // url missing
          { url: "", type: "fcm", token: "tok" },
        ),
    ).toThrow(/pushServerOpts\.url/);
  });

  it("throws when pushServerOpts.type is missing", () => {
    expect(
      () =>
        new WalletConnect(
          { bridge: bridge.url, clientMeta: CLIENT_META },
          { url: "https://push.example", type: "", token: "tok" },
        ),
    ).toThrow(/pushServerOpts\.type/);
  });

  it("throws when pushServerOpts.token is missing", () => {
    expect(
      () =>
        new WalletConnect(
          { bridge: bridge.url, clientMeta: CLIENT_META },
          { url: "https://push.example", type: "fcm", token: "" },
        ),
    ).toThrow(/pushServerOpts\.token/);
  });
});
