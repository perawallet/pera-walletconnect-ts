import { describe, it, expect, vi, afterEach } from "vitest";
import { getLocalStorage, getNavigator, getFromWindow } from "../src/browser/getters";
import { detectEnv, isAndroid, isIOS, isMobile, isBrowser, isNode } from "../src/browser/env";
import { setLocal, getLocal, removeLocal } from "../src/browser/local";
import { formatIOSMobile, saveMobileLinkInfo, mobileLinkChoiceKey } from "../src/browser/mobile";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

afterEach(() => vi.unstubAllGlobals());

describe("window getters in Node (no window)", () => {
  it("return undefined instead of throwing", () => {
    expect(getFromWindow("document")).toBeUndefined();
    expect(getNavigator()).toBeUndefined();
    expect(getLocalStorage()).toBeUndefined();
  });
});

describe("env detection", () => {
  it("detects node when no navigator exists", () => {
    expect(detectEnv()?.name).toBe("node");
    expect(isNode()).toBe(true);
    expect(isBrowser()).toBe(false);
  });
  it("detects react-native via navigator.product", () => {
    vi.stubGlobal("navigator", { product: "ReactNative" });
    expect(detectEnv()?.name).toBe("react-native");
  });
  it("classifies user agents", () => {
    expect(detectEnv(ANDROID_UA)?.os?.toLowerCase()).toContain("android");
    expect(detectEnv(IOS_UA)?.os?.toLowerCase()).toContain("ios");
    expect(detectEnv(DESKTOP_UA)?.os?.toLowerCase()).toContain("mac");
  });
  it("isAndroid / isIOS / isMobile follow the active navigator UA", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA, maxTouchPoints: 5 });
    expect(isAndroid()).toBe(true);
    expect(isMobile()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: IOS_UA, maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    expect(isMobile()).toBe(false);
  });
});

describe("local storage helpers", () => {
  it("no-op without localStorage", () => {
    expect(() => setLocal("k", { a: 1 })).not.toThrow();
    expect(getLocal("k")).toBeNull();
    expect(() => removeLocal("k")).not.toThrow();
  });
  it("round-trip with a stubbed localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    setLocal("k", { a: 1 });
    expect(getLocal("k")).toEqual({ a: 1 });
    removeLocal("k");
    expect(getLocal("k")).toBeNull();
  });
});

describe("mobile linking", () => {
  it("formatIOSMobile builds universal and deep links", () => {
    const entry = (overrides: object) => ({
      name: "Pera",
      shortName: "Pera",
      color: "",
      logo: "",
      universalLink: "",
      deepLink: "",
      ...overrides,
    });
    expect(formatIOSMobile("wc:t@1?k=v", entry({ universalLink: "https://pera.app" }))).toBe(
      `https://pera.app/wc?uri=${encodeURIComponent("wc:t@1?k=v")}`,
    );
    expect(formatIOSMobile("wc:t@1?k=v", entry({ deepLink: "pera:" }))).toBe(
      `pera://wc?uri=${encodeURIComponent("wc:t@1?k=v")}`,
    );
  });
  it("saveMobileLinkInfo strips the query from href", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    saveMobileLinkInfo({ name: "Pera", href: "pera://wc?uri=abc" });
    expect(JSON.parse(store.get(mobileLinkChoiceKey)!)).toEqual({
      name: "Pera",
      href: "pera://wc",
    });
  });
});
