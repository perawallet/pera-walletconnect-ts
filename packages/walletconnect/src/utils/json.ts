// oxlint-disable-next-line typescript/no-explicit-any -- legacy API returns untyped parsed JSON
export function safeJsonParse(value: string): any {
  if (typeof value !== "string") {
    throw new Error(`Cannot safe json parse value of type ${typeof value}`);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function safeJsonStringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
