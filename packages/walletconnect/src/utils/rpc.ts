import type { IJsonRpcErrorMessage } from "../types";

export function formatRpcError(error: Partial<IJsonRpcErrorMessage>): {
  code: number;
  message: string;
  data?: string;
} {
  const message = error.message || "Failed or Rejected Request";
  let code = -32_000;
  if (error && !error.code) {
    switch (message) {
      case "Parse error": {
        code = -32_700;
        break;
      }
      case "Invalid request": {
        code = -32_600;
        break;
      }
      case "Method not found": {
        code = -32_601;
        break;
      }
      case "Invalid params": {
        code = -32_602;
        break;
      }
      case "Internal error": {
        code = -32_603;
        break;
      }
      default: {
        code = -32_000;
        break;
      }
    }
  }
  const result: { code: number; message: string; data?: string } = {
    code,
    message,
  };
  if (error.data) {
    result.data = error.data;
  }
  return result;
}
