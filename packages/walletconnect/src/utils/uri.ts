import type {
  IParseURIResult,
  IRequiredParamsResult,
  IQueryParamsResult,
  IWalletConnectSession,
} from "../types";

export function getQueryString(url: string): string {
  const pathEnd = url.indexOf("?");
  return pathEnd >= 0 ? url.substring(pathEnd) : "";
}

export function parseQueryString(queryString: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(queryString.startsWith("?") ? queryString.substring(1) : queryString).forEach(
    (value, key) => {
      result[key] = value;
    },
  );
  return result;
}

export function formatQueryString(queryParams: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    params.append(key, String(value));
  }
  return params.toString();
}

export function appendToQueryString(
  queryString: string,
  newQueryParams: Record<string, unknown>,
): string {
  return formatQueryString({ ...parseQueryString(queryString), ...newQueryParams });
}

// oxlint-disable-next-line typescript/no-explicit-any -- legacy type guard takes untyped input
export function isWalletConnectSession(object: any): object is IWalletConnectSession {
  return typeof object.bridge !== "undefined";
}

export function parseWalletConnectUri(str: string): IParseURIResult {
  const pathStart: number = str.indexOf(":");

  const pathEnd: number | undefined = str.indexOf("?") !== -1 ? str.indexOf("?") : undefined;

  const protocol: string = str.substring(0, pathStart);

  const path: string = str.substring(pathStart + 1, pathEnd);

  function parseRequiredParams(path: string): IRequiredParamsResult {
    const separator = "@";

    const values = path.split(separator);

    const requiredParams = {
      handshakeTopic: values[0] ?? "",
      version: parseInt(values[1] ?? "", 10),
    };

    return requiredParams;
  }

  const requiredParams: IRequiredParamsResult = parseRequiredParams(path);

  const queryString: string = typeof pathEnd !== "undefined" ? str.substring(pathEnd) : "";

  function parseQueryParams(queryString: string): IQueryParamsResult {
    const result = parseQueryString(queryString);

    const parameters: IQueryParamsResult = {
      key: result.key || "",
      bridge: result.bridge || "",
    };

    return parameters;
  }

  const queryParams: IQueryParamsResult = parseQueryParams(queryString);

  const result: IParseURIResult = {
    protocol,
    ...requiredParams,
    ...queryParams,
  };

  return result;
}
