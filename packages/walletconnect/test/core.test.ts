import { describe, it, expect, vi, afterEach } from "vitest";
import EventManager from "../src/core/events";
import SessionStorage from "../src/core/storage";
import { getBridgeUrl, extractRootDomain, selectRandomBridgeUrl } from "../src/core/url";

afterEach(() => vi.unstubAllGlobals());

describe("EventManager", () => {
  it("routes request payloads to method subscribers", () => {
    const em = new EventManager();
    const calls: [Error | null, unknown][] = [];
    em.subscribe({ event: "wc_sessionRequest", callback: (e, p) => calls.push([e, p]) });
    em.trigger({ id: 1, jsonrpc: "2.0", method: "wc_sessionRequest", params: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBeNull();
  });
  it("routes responses to response:<id> subscribers", () => {
    const em = new EventManager();
    const calls: { result?: unknown }[] = [];
    em.subscribe({ event: "response:7", callback: (e, p) => calls.push(p) });
    em.trigger({ id: 7, jsonrpc: "2.0", result: "ok" });
    expect(calls[0]?.result).toBe("ok");
  });
  it("falls back to call_request for unknown non-reserved methods", () => {
    const em = new EventManager();
    const calls: unknown[] = [];
    em.subscribe({ event: "call_request", callback: (e, p) => calls.push(p) });
    em.trigger({ id: 1, jsonrpc: "2.0", method: "algo_signTxn", params: [] });
    expect(calls).toHaveLength(1);
  });
  it("converts error responses into Error callbacks", () => {
    const em = new EventManager();
    const calls: [Error | null, unknown][] = [];
    em.subscribe({ event: "response:9", callback: (e, p) => calls.push([e, p]) });
    em.trigger({ id: 9, jsonrpc: "2.0", error: { code: -32_000, message: "boom" } });
    expect(calls[0]?.[0]).toBeInstanceOf(Error);
    expect(calls[0]?.[0]?.message).toBe("boom");
  });
  it("unsubscribe stops further deliveries", () => {
    const em = new EventManager();
    const calls: unknown[] = [];
    em.subscribe({ event: "wc_sessionUpdate", callback: (_e, p) => calls.push(p) });
    em.trigger({ id: 1, jsonrpc: "2.0", method: "wc_sessionUpdate", params: [] });
    em.unsubscribe("wc_sessionUpdate");
    em.trigger({ id: 2, jsonrpc: "2.0", method: "wc_sessionUpdate", params: [] });
    expect(calls).toHaveLength(1);
  });
});

describe("SessionStorage", () => {
  it("no-ops gracefully without localStorage", () => {
    const storage = new SessionStorage();
    expect(storage.getSession()).toBeNull();
    expect(() => storage.removeSession()).not.toThrow();
  });
  it("discards persisted JSON that is not a WalletConnect session", () => {
    const store = new Map<string, string>([["walletconnect", JSON.stringify({ foo: 1 })]]);
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const storage = new SessionStorage();
    expect(storage.getSession()).toBeNull();
  });
});

describe("bridge url selection", () => {
  it("keeps non-walletconnect.org bridges untouched", () => {
    expect(getBridgeUrl("https://bridge.pera.example")).toBe("https://bridge.pera.example");
  });
  it("extractRootDomain", () => {
    expect(extractRootDomain("https://a.bridge.walletconnect.org/?x=1")).toBe("walletconnect.org");
  });
  it("rotates walletconnect.org bridges to a random pool member (legacy behavior)", () => {
    const picked = getBridgeUrl("https://bridge.walletconnect.org");
    expect(picked).toMatch(/^https:\/\/[a-z0-9]\.bridge\.walletconnect\.org$/);
    expect(selectRandomBridgeUrl()).toMatch(/^https:\/\/[a-z0-9]\.bridge\.walletconnect\.org$/);
  });
});
