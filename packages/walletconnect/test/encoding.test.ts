import { describe, it, expect } from "vitest";
import * as enc from "../src/utils/encoding";

const STR = "wallet";
const STR_HEX = "0x77616c6c6574";
const STR_BYTES = new Uint8Array([0x77, 0x61, 0x6c, 0x6c, 0x65, 0x74]);

describe("hex helpers", () => {
  it("addHexPrefix / removeHexPrefix", () => {
    expect(enc.addHexPrefix("ff")).toBe("0xff");
    expect(enc.addHexPrefix("0xff")).toBe("0xff");
    expect(enc.removeHexPrefix("0xff")).toBe("ff");
    expect(enc.removeHexPrefix("ff")).toBe("ff");
  });
  it("sanitizeHex pads odd-length and keeps prefix", () => {
    expect(enc.sanitizeHex("0xfff")).toBe("0x0fff");
    expect(enc.sanitizeHex("fff")).toBe("0x0fff");
    expect(enc.sanitizeHex("")).toBe("");
  });
  it("removeHexLeadingZeros", () => {
    expect(enc.removeHexLeadingZeros("0x0010")).toBe("0x10");
    expect(enc.removeHexLeadingZeros("0x0000")).toBe("0x0");
  });
  it("isHexString", () => {
    expect(enc.isHexString(STR_HEX)).toBe(true);
    expect(enc.isHexString("wallet")).toBe(false);
    expect(enc.isHexString(123)).toBe(false);
  });
});

describe("byte conversions", () => {
  it("hexToArray / arrayToHex round-trip", () => {
    expect(enc.hexToArray(STR_HEX)).toEqual(STR_BYTES);
    expect(enc.arrayToHex(STR_BYTES)).toBe("77616c6c6574");
    expect(enc.arrayToHex(STR_BYTES, true)).toBe(STR_HEX);
  });
  it("utf8ToArray / arrayToUtf8 round-trip", () => {
    expect(enc.utf8ToArray(STR)).toEqual(STR_BYTES);
    expect(enc.arrayToUtf8(STR_BYTES)).toBe(STR);
  });
  it("concatArrays", () => {
    expect(enc.concatArrays(new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe("ArrayBuffer converters (ICryptoLib surface)", () => {
  it("convertHexToArrayBuffer / convertArrayBufferToHex", () => {
    const ab = enc.convertHexToArrayBuffer(STR_HEX);
    expect(new Uint8Array(ab)).toEqual(STR_BYTES);
    expect(enc.convertArrayBufferToHex(ab)).toBe(STR_HEX);
    expect(enc.convertArrayBufferToHex(ab, true)).toBe("77616c6c6574");
  });
  it("convertUtf8ToArrayBuffer / convertArrayBufferToUtf8", () => {
    const ab = enc.convertUtf8ToArrayBuffer(STR);
    expect(enc.convertArrayBufferToUtf8(ab)).toBe(STR);
  });
});

describe("number conversions (BigInt replaces bn.js)", () => {
  it("convertNumberToHex", () => {
    expect(enc.convertNumberToHex(16)).toBe("0x10");
    expect(enc.convertNumberToHex(16, true)).toBe("10");
    expect(enc.convertNumberToHex("16")).toBe("0x10");
    expect(enc.convertNumberToHex(255)).toBe("0xff");
  });
  it("convertHexToNumber / convertUtf8ToNumber", () => {
    expect(enc.convertHexToNumber("0x10")).toBe(16);
    expect(enc.convertUtf8ToNumber("16")).toBe(16);
  });
});

describe("invalid input hardening", () => {
  it("convertNumberToHex throws on negative numbers", () => {
    expect(() => enc.convertNumberToHex(-5)).toThrowError(RangeError);
  });
  it("convertNumberToHex throws on bare hex strings (legacy bn.js parity)", () => {
    expect(() => enc.convertNumberToHex("ff")).toThrow();
  });
  it("hexToArray throws on invalid hex characters", () => {
    expect(() => enc.hexToArray("0x1G2F")).toThrowError(TypeError);
  });
  it("convertHexToNumber throws above MAX_SAFE_INTEGER", () => {
    expect(() => enc.convertHexToNumber("0xffffffffffffffff")).toThrowError(RangeError);
  });
  it("isHexString enforces an explicit zero length", () => {
    expect(enc.isHexString("0xff", 0)).toBe(false);
    expect(enc.isHexString("0x", 0)).toBe(true);
  });
  it("addHexPrefix does not double an uppercase 0X prefix", () => {
    expect(enc.addHexPrefix("0Xff")).toBe("0Xff");
  });
});
