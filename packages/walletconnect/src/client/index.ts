import Connector from "../core/connector";
import * as cryptoLib from "../crypto";
import type { IPushServerOptions, IWalletConnectOptions } from "../types";

export class WalletConnect extends Connector {
  constructor(connectorOpts: IWalletConnectOptions, pushServerOpts?: IPushServerOptions) {
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
      throw new Error(
        "crypto.getRandomValues is not available. In React Native, install a polyfill " +
          "such as react-native-quick-crypto or react-native-get-random-values before " +
          "constructing WalletConnect.",
      );
    }
    super({
      cryptoLib,
      connectorOpts,
      sessionStorage: connectorOpts.storage,
      pushServerOpts,
    });
  }
}

export default WalletConnect;
