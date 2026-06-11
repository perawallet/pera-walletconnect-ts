import { cbc } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// WC v1 scheme: AES-256-CBC with PKCS#7 padding (noble's cbc default),
// authenticated by HMAC-SHA256 over ciphertext||iv.

export function aesCbcEncrypt(iv: Uint8Array, key: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, iv).encrypt(data);
}

export function aesCbcDecrypt(iv: Uint8Array, key: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, iv).decrypt(data);
}

export function hmacSha256Sign(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}
