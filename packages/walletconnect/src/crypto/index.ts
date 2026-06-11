import type {
  IEncryptionPayload,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
} from "../types";
import { arrayToHex, arrayToUtf8, concatArrays, hexToArray, utf8ToArray } from "../utils/encoding";
import { aesCbcDecrypt, aesCbcEncrypt, hmacSha256Sign } from "./primitives";
import { randomBytes } from "./random";

type JsonRpcPayload = IJsonRpcRequest | IJsonRpcResponseSuccess | IJsonRpcResponseError;

/**
 * Generates a random key. `length` is in BITS (legacy WalletConnect ICryptoLib
 * contract — NOT bytes); defaults to 256. Must be a positive multiple of 8.
 */
export async function generateKey(length?: number): Promise<ArrayBuffer> {
  const bits = length || 256;
  if (bits <= 0 || bits % 8 !== 0) {
    throw new RangeError("generateKey: length must be a positive multiple of 8 bits");
  }
  return randomBytes(bits / 8).buffer as ArrayBuffer;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function verifyHmac(payload: IEncryptionPayload, key: Uint8Array): Promise<boolean> {
  const cipherText = hexToArray(payload.data);
  const iv = hexToArray(payload.iv);
  const expected = hexToArray(payload.hmac);
  const actual = hmacSha256Sign(key, concatArrays(cipherText, iv));
  return constantTimeEqual(expected, actual);
}

export async function encrypt(
  data: JsonRpcPayload,
  key: ArrayBuffer,
  providedIv?: ArrayBuffer,
): Promise<IEncryptionPayload> {
  const keyBytes = new Uint8Array(key);
  const iv = providedIv ? new Uint8Array(providedIv) : randomBytes(16);
  const content = utf8ToArray(JSON.stringify(data));
  const cipherText = aesCbcEncrypt(iv, keyBytes, content);
  const hmac = hmacSha256Sign(keyBytes, concatArrays(cipherText, iv));
  return {
    data: arrayToHex(cipherText),
    hmac: arrayToHex(hmac),
    iv: arrayToHex(iv),
  };
}

export async function decrypt(
  payload: IEncryptionPayload,
  key: ArrayBuffer,
): Promise<JsonRpcPayload | null> {
  const keyBytes = new Uint8Array(key);
  if (!keyBytes.length) {
    throw new Error("Missing key: required for decryption");
  }
  try {
    if (!(await verifyHmac(payload, keyBytes))) {
      return null;
    }
    const buffer = aesCbcDecrypt(hexToArray(payload.iv), keyBytes, hexToArray(payload.data));
    return JSON.parse(arrayToUtf8(buffer));
  } catch {
    return null;
  }
}
