import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ITxData } from "../types";
import {
  addHexPrefix,
  arrayToHex,
  convertNumberToHex,
  convertUtf8ToHex,
  removeHexLeadingZeros,
  removeHexPrefix,
  sanitizeHex,
  utf8ToArray,
} from "./encoding";
import { isEmptyArray, isHexString, isEmptyString } from "./validators";

export function toChecksumAddress(address: string): string {
  address = removeHexPrefix(address.toLowerCase());
  const hash = arrayToHex(keccak_256(utf8ToArray(address)));
  let checksum = "";
  for (let i = 0; i < address.length; i++) {
    if (parseInt(hash[i]!, 16) > 7) {
      checksum += address[i]!.toUpperCase();
    } else {
      checksum += address[i]!;
    }
  }
  return addHexPrefix(checksum);
}

export const isValidAddress = (address?: string) => {
  if (!address) {
    return false;
  } else if (address.toLowerCase().substring(0, 2) !== "0x") {
    return false;
  } else if (!/^(0x)?[0-9a-f]{40}$/i.test(address)) {
    return false;
  } else if (/^(0x)?[0-9a-f]{40}$/.test(address) || /^(0x)?[0-9A-F]{40}$/.test(address)) {
    return true;
  } else {
    return address === toChecksumAddress(address);
  }
};

export function parsePersonalSign(params: string[]): string[] {
  if (!isEmptyArray(params) && !isHexString(params[0])) {
    params[0] = convertUtf8ToHex(params[0]!);
  }
  return params;
}

export function parseTransactionData(txData: Partial<ITxData>): Partial<ITxData> {
  if (typeof txData.type !== "undefined" && txData.type !== "0") return txData;

  if (typeof txData.from === "undefined" || !isValidAddress(txData.from)) {
    throw new Error(`Transaction object must include a valid 'from' value.`);
  }

  function parseHexValues(value: number | string) {
    let result = value;
    if (typeof value === "number" || (typeof value === "string" && !isEmptyString(value))) {
      if (!isHexString(value)) {
        result = convertNumberToHex(value);
      } else if (typeof value === "string") {
        result = sanitizeHex(value);
      }
    }
    if (typeof result === "string") {
      result = removeHexLeadingZeros(result);
    }
    return result;
  }

  const txDataRPC = {
    from: sanitizeHex(txData.from),
    to: typeof txData.to === "undefined" ? undefined : sanitizeHex(txData.to),
    gasPrice: typeof txData.gasPrice === "undefined" ? "" : parseHexValues(txData.gasPrice),
    gas:
      typeof txData.gas === "undefined"
        ? typeof txData.gasLimit === "undefined"
          ? ""
          : parseHexValues(txData.gasLimit)
        : parseHexValues(txData.gas),
    value: typeof txData.value === "undefined" ? "" : parseHexValues(txData.value),
    nonce: typeof txData.nonce === "undefined" ? "" : parseHexValues(txData.nonce),
    data: typeof txData.data === "undefined" ? "0x" : sanitizeHex(txData.data) || "0x",
  };

  const prunable = ["gasPrice", "gas", "value", "nonce"];
  Object.keys(txDataRPC).forEach((key: string) => {
    if (
      (typeof (txDataRPC as Record<string, unknown>)[key] === "undefined" ||
        (typeof (txDataRPC as Record<string, unknown>)[key] === "string" &&
          !(txDataRPC as Record<string, unknown>)[key]!.toString().trim().length)) &&
      prunable.includes(key)
    ) {
      delete (txDataRPC as Record<string, unknown>)[key];
    }
  });

  return txDataRPC;
}
