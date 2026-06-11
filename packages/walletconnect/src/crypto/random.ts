export function randomBytes(length: number): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error(
      "crypto.getRandomValues is not available. In React Native, install a polyfill " +
        "such as react-native-quick-crypto or react-native-get-random-values before " +
        "importing @perawallet/walletconnect.",
    );
  }
  return cryptoObj.getRandomValues(new Uint8Array(length));
}
