import { describe, it, expect, vi } from "vitest";
import WalletConnect from "../src";
import type { IWalletConnectSession, ISessionStorage } from "../src/types";

const BRIDGE = "https://bridge.pera.example";

describe("WalletConnect client", () => {
  it("instantiates with a bridge and exposes WC v1 surface", () => {
    const connector = new WalletConnect({ bridge: BRIDGE });
    expect(connector.bridge).toBe(BRIDGE);
    expect(connector.protocol).toBe("wc");
    expect(connector.version).toBe(1);
    expect(connector.connected).toBe(false);
    expect(typeof connector.createSession).toBe("function");
    expect(typeof connector.killSession).toBe("function");
    expect(typeof connector.sendCustomRequest).toBe("function");
    expect(typeof connector.approveSession).toBe("function");
    connector.transportClose();
  });

  it("throws without bridge, uri, or session", () => {
    expect(() => new WalletConnect({})).toThrowError(/bridge \/ uri \/ session/);
  });

  it("restores a session from an injected storage adapter", () => {
    const session: IWalletConnectSession = {
      connected: true,
      accounts: ["ALGOADDRESS"],
      chainId: 4160,
      bridge: BRIDGE,
      key: "aa".repeat(32),
      clientId: "client-id",
      clientMeta: null,
      peerId: "peer-id",
      peerMeta: null,
      handshakeId: 1,
      handshakeTopic: "topic",
    };
    const storage: ISessionStorage = {
      getSession: () => session,
      setSession: s => s,
      removeSession: () => undefined,
    };
    const connector = new WalletConnect({ bridge: BRIDGE, storage });
    expect(connector.connected).toBe(true);
    expect(connector.accounts).toEqual(["ALGOADDRESS"]);
    expect(connector.session.key).toBe("aa".repeat(32));
    connector.transportClose();
  });

  it("parses a wc: uri", () => {
    const key = "bb".repeat(32);
    const connector = new WalletConnect({
      uri: `wc:topic-x@1?bridge=${encodeURIComponent(BRIDGE)}&key=${key}`,
    });
    expect(connector.bridge).toBe(BRIDGE);
    expect(connector.handshakeTopic).toBe("topic-x");
    expect(connector.key).toBe(key);
    connector.transportClose();
  });

  it("fails fast with a clear error when crypto.getRandomValues is missing", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => new WalletConnect({ bridge: BRIDGE })).toThrowError(/getRandomValues/);
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});
