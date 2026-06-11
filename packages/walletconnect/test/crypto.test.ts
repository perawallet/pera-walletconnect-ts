import { describe, it, expect, vi } from "vitest";
import { generateKey, encrypt, decrypt, verifyHmac } from "../src/crypto";
import { randomBytes } from "../src/crypto/random";
import { convertHexToArrayBuffer, hexToArray } from "../src/utils/encoding";
import type { IJsonRpcRequest } from "../src/types";

// Upstream-committed golden vector (packages/helpers/iso-crypto/test/index.spec.ts)
const TEST_JSON_RPC_REQUEST: IJsonRpcRequest = {
  id: 1,
  jsonrpc: "2.0",
  method: "wc_test",
  params: [],
};
const TEST_KEY = "2254c5145902fe280fb035e98bea896e024b78ccab33a62a38f538c860d60339";
const TEST_IV = "81413061def750d1a8f857d98d66584d";
const TEST_ENCRYPTION_PAYLOAD = {
  data: "170ac2b0c8ba61ac268455c42eb72c452e23888c6b357bcfc1b8c4c12770690c714e2171ceee0fa4aa639bcbfb9c6b111cbad0f73759c782253a3b4c0da1c43e",
  hmac: "f779131fb8976435eb6984c23f597ffdf2f2a7122543d27907774c0f92142d33",
  iv: "81413061def750d1a8f857d98d66584d",
};

describe("crypto golden vectors (WC v1 wire format)", () => {
  it("encrypt reproduces the upstream payload byte-for-byte", async () => {
    const result = await encrypt(
      TEST_JSON_RPC_REQUEST,
      convertHexToArrayBuffer(TEST_KEY),
      convertHexToArrayBuffer(TEST_IV),
    );
    expect(result).toEqual(TEST_ENCRYPTION_PAYLOAD);
  });

  it("decrypt consumes the upstream payload", async () => {
    const result = await decrypt(TEST_ENCRYPTION_PAYLOAD, convertHexToArrayBuffer(TEST_KEY));
    expect(result).toEqual(TEST_JSON_RPC_REQUEST);
  });

  it("verifyHmac accepts valid and rejects tampered payloads", async () => {
    const key = hexToArray(TEST_KEY);
    expect(await verifyHmac(TEST_ENCRYPTION_PAYLOAD, key)).toBe(true);
    const tampered = {
      ...TEST_ENCRYPTION_PAYLOAD,
      hmac: "00" + TEST_ENCRYPTION_PAYLOAD.hmac.slice(2),
    };
    expect(await verifyHmac(tampered, key)).toBe(false);
  });

  it("decrypt returns null for tampered ciphertext", async () => {
    const tampered = {
      ...TEST_ENCRYPTION_PAYLOAD,
      data: "00" + TEST_ENCRYPTION_PAYLOAD.data.slice(2),
    };
    expect(await decrypt(tampered, convertHexToArrayBuffer(TEST_KEY))).toBeNull();
  });
});

describe("key generation", () => {
  it("generateKey returns 32 random bytes by default", async () => {
    const a = new Uint8Array(await generateKey());
    const b = new Uint8Array(await generateKey());
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a).not.toEqual(b);
  });

  it("randomBytes throws a clear error without crypto.getRandomValues", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => randomBytes(32)).toThrowError(/getRandomValues/);
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});

describe("round-trip", () => {
  it("encrypt → decrypt round-trips with a fresh key", async () => {
    const key = await generateKey();
    const payload = await encrypt(TEST_JSON_RPC_REQUEST, key);
    expect(await decrypt(payload, key)).toEqual(TEST_JSON_RPC_REQUEST);
  });
});

describe("decrypt hardening", () => {
  it("decrypt returns null with a wrong key", async () => {
    const wrongKey = new Uint8Array(32).fill(7).buffer as ArrayBuffer;
    expect(await decrypt(TEST_ENCRYPTION_PAYLOAD, wrongKey)).toBeNull();
  });

  it("decrypt returns null for malformed (non-hex) wire payloads", async () => {
    const key = convertHexToArrayBuffer(TEST_KEY);
    expect(await decrypt({ data: "zz-not-hex", hmac: "00", iv: "00" }, key)).toBeNull();
    expect(await decrypt({ ...TEST_ENCRYPTION_PAYLOAD, iv: "nope" }, key)).toBeNull();
  });

  it("decrypt returns null for an empty data field", async () => {
    const key = convertHexToArrayBuffer(TEST_KEY);
    expect(await decrypt({ ...TEST_ENCRYPTION_PAYLOAD, data: "" }, key)).toBeNull();
  });

  it("generateKey rejects non-multiple-of-8 bit lengths", async () => {
    await expect(generateKey(100)).rejects.toThrowError(RangeError);
  });

  it("verifyHmac rejects an hmac of the wrong length", async () => {
    const key = hexToArray(TEST_KEY);
    const truncated = {
      ...TEST_ENCRYPTION_PAYLOAD,
      hmac: TEST_ENCRYPTION_PAYLOAD.hmac.slice(0, 32),
    };
    expect(await verifyHmac(truncated, key)).toBe(false);
  });

  it("decrypt throws on an empty key (caller error, not wire data)", async () => {
    await expect(decrypt(TEST_ENCRYPTION_PAYLOAD, new ArrayBuffer(0))).rejects.toThrowError(
      /Missing key/,
    );
  });
});
