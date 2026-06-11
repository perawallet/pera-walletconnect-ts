import { describe, it, expect } from "vitest";
import {
  getQueryString,
  appendToQueryString,
  parseQueryString,
  formatQueryString,
  parseWalletConnectUri,
  isWalletConnectSession,
} from "../src/utils/uri";

describe("query string helpers", () => {
  it("getQueryString extracts from ? onward", () => {
    expect(getQueryString("https://x.y/path?a=1&b=2")).toBe("?a=1&b=2");
    expect(getQueryString("https://x.y/path")).toBe("");
  });
  it("parse/format round-trip", () => {
    expect(parseQueryString("?a=1&b=two")).toEqual({ a: "1", b: "two" });
    expect(formatQueryString({ a: "1", b: "two" })).toBe("a=1&b=two");
  });
  it("appendToQueryString merges params", () => {
    expect(parseQueryString(appendToQueryString("?a=1", { b: "2" }))).toEqual({ a: "1", b: "2" });
  });
});

describe("parseWalletConnectUri", () => {
  it("parses the WC v1 URI format", () => {
    const uri =
      "wc:8a5e5bdc-a0e4-47...TopicId@1?bridge=https%3A%2F%2Fbridge.example.org&key=41791102999c339c844880b23950704cc43aa840f3739e365323cda4dfa89e7a";
    const result = parseWalletConnectUri(uri);
    expect(result.protocol).toBe("wc");
    expect(result.handshakeTopic).toBe("8a5e5bdc-a0e4-47...TopicId");
    expect(result.version).toBe(1);
    expect(result.bridge).toBe("https://bridge.example.org");
    expect(result.key).toBe("41791102999c339c844880b23950704cc43aa840f3739e365323cda4dfa89e7a");
  });
});

describe("isWalletConnectSession", () => {
  it("detects session objects by bridge field", () => {
    expect(isWalletConnectSession({ bridge: "https://b" })).toBe(true);
    expect(isWalletConnectSession({})).toBe(false);
  });
});
