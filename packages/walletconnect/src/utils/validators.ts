/* oxlint-disable typescript/no-explicit-any -- legacy type-guard signatures take untyped wire payloads */
import type {
  IInternalEvent,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
  IJsonRpcSubscription,
} from "../types";
import { isHexString } from "./encoding";
import { reservedEvents, signingMethods } from "./constants";

export { isHexString };

export function isEmptyString(value: string): boolean {
  return value === "" || (typeof value === "string" && value.trim() === "");
}

export function isEmptyArray(array: any[]): boolean {
  return !(array && array.length);
}

export function isJsonRpcSubscription(object: any): object is IJsonRpcSubscription {
  return typeof object.params === "object";
}

export function isJsonRpcRequest(object: any): object is IJsonRpcRequest {
  return typeof object.method !== "undefined";
}

export function isJsonRpcResponseSuccess(object: any): object is IJsonRpcResponseSuccess {
  return typeof object.result !== "undefined";
}

export function isJsonRpcResponseError(object: any): object is IJsonRpcResponseError {
  return typeof object.error !== "undefined";
}

export function isInternalEvent(object: any): object is IInternalEvent {
  return typeof object.event !== "undefined";
}

export function isReservedEvent(event: string) {
  return reservedEvents.includes(event) || event.startsWith("wc_");
}

export function isSilentPayload(request: IJsonRpcRequest): boolean {
  if (request.method.startsWith("wc_")) {
    return true;
  }
  if (signingMethods.includes(request.method)) {
    return false;
  }
  return true;
}
