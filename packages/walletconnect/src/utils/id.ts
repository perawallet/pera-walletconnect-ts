import { randomBytes } from "../crypto/random";
import { arrayToHex } from "./encoding";

// Math.random is deliberate here: payloadId is a non-secret JSON-RPC id
// (legacy @walletconnect/jsonrpc-utils semantics), not security-sensitive.
export function payloadId(): number {
  const date = Date.now() * 1000;
  const extra = Math.floor(Math.random() * 1000);
  return date + extra;
}

export function uuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = arrayToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
