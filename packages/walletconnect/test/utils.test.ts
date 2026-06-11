import { describe, it, expect } from "vitest";
import { safeJsonParse, safeJsonStringify } from "../src/utils/json";
import { payloadId, uuid } from "../src/utils/id";
import { formatRpcError } from "../src/utils/rpc";
import {
  isJsonRpcRequest,
  isJsonRpcResponseSuccess,
  isJsonRpcResponseError,
  isInternalEvent,
  isReservedEvent,
  isSilentPayload,
} from "../src/utils/validators";

describe("safe json", () => {
  it("parses valid JSON and passes through invalid", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse("not-json")).toBe("not-json");
  });
  it("stringifies non-strings and passes through strings", () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeJsonStringify("already")).toBe("already");
  });
});

describe("ids", () => {
  it("payloadId is a unique positive integer", () => {
    const a = payloadId();
    const b = payloadId();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
  it("uuid is RFC4122 v4 shaped", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid()).not.toBe(uuid());
  });
});

describe("formatRpcError", () => {
  it("maps known messages to codes and defaults to -32000", () => {
    expect(formatRpcError({ message: "Method not found" }).code).toBe(-32_601);
    expect(formatRpcError({}).message).toBe("Failed or Rejected Request");
    expect(formatRpcError({}).code).toBe(-32_000);
  });
});

describe("payload validators", () => {
  it("classifies payload shapes", () => {
    expect(isJsonRpcRequest({ method: "x" })).toBe(true);
    expect(isJsonRpcResponseSuccess({ result: 1 })).toBe(true);
    expect(isJsonRpcResponseError({ error: { message: "x" } })).toBe(true);
    expect(isInternalEvent({ event: "connect" })).toBe(true);
  });
  it("isReservedEvent covers wc_ prefix and reserved list", () => {
    expect(isReservedEvent("connect")).toBe(true);
    expect(isReservedEvent("wc_sessionRequest")).toBe(true);
    expect(isReservedEvent("algo_signTxn")).toBe(false);
  });
  it("isSilentPayload: wc_ methods silent, signing methods loud, others silent", () => {
    expect(isSilentPayload({ id: 1, jsonrpc: "2.0", method: "wc_sessionUpdate", params: [] })).toBe(
      true,
    );
    expect(
      isSilentPayload({ id: 1, jsonrpc: "2.0", method: "eth_sendTransaction", params: [] }),
    ).toBe(false);
    expect(isSilentPayload({ id: 1, jsonrpc: "2.0", method: "eth_getBalance", params: [] })).toBe(
      true,
    );
  });
});
