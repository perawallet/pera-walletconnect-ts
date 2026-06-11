// Vendored replacement for @walletconnect/encoding (Apache-2.0) and the
// bn.js-based converters from @walletconnect/utils. Uint8Array-native; the
// ArrayBuffer variants exist because ICryptoLib's frozen signatures use them.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// -- hex string helpers ----------------------------------------------------

export function removeHexPrefix(hex: string): string {
  return hex.replace(/^0x/i, "");
}

export function addHexPrefix(hex: string): string {
  return /^0x/i.test(hex) ? hex : `0x${hex}`;
}

export function sanitizeHex(hex: string): string {
  hex = removeHexPrefix(hex);
  if (!hex) {
    return "";
  }
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  return addHexPrefix(hex);
}

export function removeHexLeadingZeros(hex: string): string {
  const stripped = removeHexPrefix(hex).replace(/^0+(?=.)/, "");
  return addHexPrefix(stripped);
}

export function isHexString(value: unknown, length?: number): boolean {
  if (typeof value !== "string" || !/^0x[0-9A-Fa-f]*$/.test(value)) {
    return false;
  }
  if (length !== undefined && value.length !== 2 + 2 * length) {
    return false;
  }
  return true;
}

// -- bytes ------------------------------------------------------------------

const HEX_CHARS = "0123456789abcdef";

export function hexToArray(hex: string): Uint8Array {
  const clean = removeHexPrefix(sanitizeHex(hex));
  if (clean && !/^[0-9a-f]+$/i.test(clean)) {
    throw new TypeError(`hexToArray: invalid hex string "${hex}"`);
  }
  const result = new Uint8Array(clean.length / 2);
  for (let i = 0; i < result.length; i++) {
    result[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return result;
}

export function arrayToHex(arr: Uint8Array, prefixed = false): string {
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += HEX_CHARS[arr[i]! >> 4]! + HEX_CHARS[arr[i]! & 0x0f]!;
  }
  return prefixed ? addHexPrefix(hex) : hex;
}

export function utf8ToArray(utf8: string): Uint8Array {
  return textEncoder.encode(utf8);
}

export function arrayToUtf8(arr: Uint8Array): string {
  return textDecoder.decode(arr);
}

export function concatArrays(...args: Uint8Array[]): Uint8Array {
  const length = args.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const arr of args) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// -- ArrayBuffer variants (ICryptoLib signatures) ----------------------------

export function convertHexToArrayBuffer(hex: string): ArrayBuffer {
  return hexToArray(hex).buffer as ArrayBuffer;
}

export function convertArrayBufferToHex(ab: ArrayBuffer, noPrefix?: boolean): string {
  return arrayToHex(new Uint8Array(ab), !noPrefix);
}

export function convertUtf8ToArrayBuffer(utf8: string): ArrayBuffer {
  return utf8ToArray(utf8).buffer as ArrayBuffer;
}

export function convertArrayBufferToUtf8(ab: ArrayBuffer): string {
  return arrayToUtf8(new Uint8Array(ab));
}

// -- numbers (BigInt replaces bn.js) ------------------------------------------

export function convertNumberToHex(num: number | string, noPrefix?: boolean): string {
  const value = typeof num === "string" ? BigInt(num) : BigInt(Math.trunc(num));
  if (value < 0n) {
    throw new RangeError("convertNumberToHex: negative values are not supported");
  }
  const hex = removeHexPrefix(sanitizeHex(value.toString(16)));
  return noPrefix ? hex : addHexPrefix(hex);
}

export function convertHexToNumber(hex: string): number {
  const n = BigInt(addHexPrefix(removeHexPrefix(hex) || "0"));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("value exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(n);
}

export function convertUtf8ToNumber(utf8: string): number {
  const n = BigInt(utf8);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("value exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(n);
}

export function convertUtf8ToHex(utf8: string, noPrefix?: boolean): string {
  const hex = arrayToHex(utf8ToArray(utf8));
  return noPrefix ? hex : addHexPrefix(hex);
}

export function convertHexToUtf8(hex: string): string {
  return arrayToUtf8(hexToArray(hex));
}
