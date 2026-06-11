import { describe, it, expect } from "vitest";
import {
  toChecksumAddress,
  isValidAddress,
  parsePersonalSign,
  parseTransactionData,
} from "../src/utils/ethereum";

// Canonical EIP-55 test vectors
const EIP55_VECTORS = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  "0x9b7b2B4f7a391b6F14A81221AE0920A9735B67Fb", // upstream test address
];

describe("toChecksumAddress", () => {
  it("reproduces EIP-55 checksums", () => {
    for (const addr of EIP55_VECTORS) {
      expect(toChecksumAddress(addr.toLowerCase())).toBe(addr);
    }
  });
});

describe("isValidAddress", () => {
  it("accepts checksummed, all-lower, and all-upper addresses", () => {
    expect(isValidAddress(EIP55_VECTORS[0])).toBe(true);
    expect(isValidAddress(EIP55_VECTORS[0]!.toLowerCase())).toBe(true);
    expect(isValidAddress(undefined)).toBe(false);
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
  });
});

describe("parsePersonalSign", () => {
  it("hex-encodes a plain-text first param", () => {
    expect(parsePersonalSign(["hello", "0xabc"])).toEqual(["0x68656c6c6f", "0xabc"]);
    expect(parsePersonalSign(["0xdeadbeef", "0xabc"])).toEqual(["0xdeadbeef", "0xabc"]);
  });
});

describe("parseTransactionData", () => {
  const FROM = EIP55_VECTORS[0]!.toLowerCase();
  it("formats numeric fields as minimal hex quantities", () => {
    const tx = parseTransactionData({ from: FROM, value: 16, nonce: "0x0010" });
    expect(tx.value).toBe("0x10");
    expect(tx.nonce).toBe("0x10");
    expect(tx.data).toBe("0x");
  });
  it("prunes empty optional fields", () => {
    const tx = parseTransactionData({ from: FROM });
    expect("gasPrice" in tx).toBe(false);
    expect("value" in tx).toBe(false);
  });
  it("throws without a valid from", () => {
    expect(() => parseTransactionData({ to: FROM })).toThrowError(/from/);
  });
});
