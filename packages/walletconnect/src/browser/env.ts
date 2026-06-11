import { getNavigator } from "./getters";

export interface IEnvInfo {
  name: string;
  version?: string;
  os?: string;
}

function detectOSFromUA(ua: string): string | undefined {
  if (/android/i.test(ua)) return "Android OS";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "Mac OS";
  if (/linux/i.test(ua)) return "Linux";
  return undefined;
}

function detectBrowserName(ua: string): string {
  if (/edg\//i.test(ua)) return "edge";
  if (/opr\/|opera/i.test(ua)) return "opera";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/chrome|crios/i.test(ua)) return "chrome";
  if (/safari/i.test(ua)) return "safari";
  return "browser";
}

export function detectEnv(userAgent?: string): IEnvInfo | null {
  // When called with an explicit UA, classify it directly.
  if (userAgent) {
    return { name: detectBrowserName(userAgent), os: detectOSFromUA(userAgent) };
  }
  const navigatorObj = getNavigator() ?? (typeof navigator !== "undefined" ? navigator : undefined);
  // React Native detection (works in both RN and Node-bundled RN environments).
  // oxlint-disable-next-line typescript/no-explicit-any -- `product` is not in the Navigator type
  if (navigatorObj && (navigatorObj as any).product === "ReactNative") {
    return { name: "react-native" };
  }
  // If the navigator has a non-Node userAgent (i.e., it's been stubbed or we're in a browser),
  // use it. Node 22+ exposes navigator with a UA like "Node.js/22" which we skip.
  const ua = navigatorObj?.userAgent;
  if (ua && !/^Node\.js\//i.test(ua)) {
    return { name: detectBrowserName(ua), os: detectOSFromUA(ua) };
  }
  // Fall back to Node.js detection.
  if (typeof process !== "undefined" && process.versions?.node) {
    return { name: "node", version: process.versions.node, os: process.platform };
  }
  return null;
}

export function detectOS(): string | undefined {
  return detectEnv()?.os ?? undefined;
}

export function isAndroid(): boolean {
  const os = detectOS();
  return os ? os.toLowerCase().includes("android") : false;
}

export function isIOS(): boolean {
  const os = detectOS();
  const navigatorObj = getNavigator() ?? (typeof navigator !== "undefined" ? navigator : undefined);
  return os
    ? os.toLowerCase().includes("ios") ||
        (os.toLowerCase().includes("mac") && (navigatorObj?.maxTouchPoints ?? 0) > 1)
    : false;
}

export function isMobile(): boolean {
  return isAndroid() || isIOS();
}

export function isNode(): boolean {
  return detectEnv()?.name === "node";
}

export function isBrowser(): boolean {
  return !isNode() && !!getNavigator();
}
