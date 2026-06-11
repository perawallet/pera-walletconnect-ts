import { describe, it, expect } from "vitest";
// eslint-disable-next-line import/no-extraneous-dependencies -- interop oracle
import * as legacyCrypto from "@walletconnect/crypto";
import { encrypt, decrypt, generateKey } from "../../src/crypto";
import { hexToArray, arrayToHex } from "../../src/utils/encoding";
import type { IJsonRpcRequest } from "../../src/types";

const REQUEST: IJsonRpcRequest = {
  id: 42,
  jsonrpc: "2.0",
  method: "wc_test",
  params: [{ pera: true }],
};

describe("crypto interop with @walletconnect/crypto", () => {
  it("legacy primitives and new primitives agree on AES-CBC + HMAC", async () => {
    const key = new Uint8Array(await generateKey());
    const iv = new Uint8Array(await generateKey(128));
    const data = new TextEncoder().encode(JSON.stringify(REQUEST));

    const legacyCipher = await legacyCrypto.aesCbcEncrypt(iv, key, data);
    const newPayload = await encrypt(REQUEST, key.buffer as ArrayBuffer, iv.buffer as ArrayBuffer);
    expect(newPayload.data).toBe(arrayToHex(new Uint8Array(legacyCipher)));

    const legacyHmac = await legacyCrypto.hmacSha256Sign(
      key,
      new Uint8Array([...new Uint8Array(legacyCipher), ...iv]),
    );
    expect(newPayload.hmac).toBe(arrayToHex(new Uint8Array(legacyHmac)));
  });

  it("new client decrypts what legacy encrypts (via primitives) and vice versa", async () => {
    const key = new Uint8Array(await generateKey());
    const payload = await encrypt(REQUEST, key.buffer as ArrayBuffer);
    const legacyPlain = await legacyCrypto.aesCbcDecrypt(
      hexToArray(payload.iv),
      key,
      hexToArray(payload.data),
    );
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(legacyPlain)))).toEqual(REQUEST);

    const roundTrip = await decrypt(payload, key.buffer as ArrayBuffer);
    expect(roundTrip).toEqual(REQUEST);
  });
});
