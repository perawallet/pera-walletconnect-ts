/**
 * Exhaustive table tests for formatRpcError (src/utils/rpc.ts).
 */

import { describe, it, expect } from "vitest";
import { formatRpcError } from "../src/utils/rpc";

describe("formatRpcError – known message → code mapping", () => {
  const cases: [string, number][] = [
    ["Parse error", -32_700],
    ["Invalid request", -32_600],
    ["Method not found", -32_601],
    ["Invalid params", -32_602],
    ["Internal error", -32_603],
  ];

  for (const [message, expectedCode] of cases) {
    it(`"${message}" maps to ${expectedCode}`, () => {
      const result = formatRpcError({ message });
      expect(result.code).toBe(expectedCode);
      expect(result.message).toBe(message);
    });
  }

  it("unknown message defaults to -32000", () => {
    const result = formatRpcError({ message: "Something unexpected" });
    expect(result.code).toBe(-32_000);
    expect(result.message).toBe("Something unexpected");
  });

  it("empty object uses default message and -32000", () => {
    const result = formatRpcError({});
    expect(result.message).toBe("Failed or Rejected Request");
    expect(result.code).toBe(-32_000);
  });

  it("when error.code is truthy the switch is skipped and code defaults to -32000", () => {
    // The source: `if (error && !error.code)` — when code is provided and non-zero,
    // the switch is skipped and the initialised -32000 is returned unchanged.
    const result = formatRpcError({ code: -32_099, message: "Parse error" });
    // The message-→-code switch is NOT executed because !error.code is false.
    // The initialised `code` value (-32000) remains.
    expect(result.code).toBe(-32_000);
    expect(result.message).toBe("Parse error");
  });

  it("data field is included when present", () => {
    const result = formatRpcError({ message: "Internal error", data: "stack trace here" });
    expect(result.data).toBe("stack trace here");
  });

  it("data field is absent when not provided", () => {
    const result = formatRpcError({ message: "Internal error" });
    expect(Object.prototype.hasOwnProperty.call(result, "data")).toBe(false);
  });
});
