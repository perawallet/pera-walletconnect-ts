/**
 * Tests for getMobileRegistryEntry and getMobileLinkRegistry
 * (src/browser/mobile.ts).
 */

import { describe, it, expect } from "vitest";
import { getMobileRegistryEntry, getMobileLinkRegistry } from "../src/browser/mobile";
import type { IMobileRegistry, IMobileRegistryEntry } from "../src/types";

// Minimal factory for registry entries
function entry(overrides: Partial<IMobileRegistryEntry> & { name: string }): IMobileRegistryEntry {
  return {
    shortName: overrides.name,
    color: "",
    logo: "",
    universalLink: "",
    deepLink: "",
    ...overrides,
  };
}

const REGISTRY: IMobileRegistry = [
  entry({ name: "Pera Wallet" }),
  entry({ name: "MetaMask" }),
  entry({ name: "Trust Wallet" }),
  entry({ name: "Rainbow" }),
];

describe("getMobileRegistryEntry", () => {
  it("finds an entry by exact name (case-insensitive)", () => {
    expect(getMobileRegistryEntry(REGISTRY, "pera wallet")?.name).toBe("Pera Wallet");
    expect(getMobileRegistryEntry(REGISTRY, "METAMASK")?.name).toBe("MetaMask");
  });

  it("finds an entry by partial name", () => {
    expect(getMobileRegistryEntry(REGISTRY, "Pera")?.name).toBe("Pera Wallet");
    expect(getMobileRegistryEntry(REGISTRY, "trust")?.name).toBe("Trust Wallet");
  });

  it("returns undefined when no match", () => {
    expect(getMobileRegistryEntry(REGISTRY, "Phantom")).toBeUndefined();
  });

  it("returns the first match when multiple entries match the substring", () => {
    // "Wallet" is a substring of both "Pera Wallet" and "Trust Wallet"
    const result = getMobileRegistryEntry(REGISTRY, "Wallet");
    expect(result?.name).toBe("Pera Wallet"); // first match
  });
});

describe("getMobileLinkRegistry", () => {
  it("returns the full registry when no whitelist is provided", () => {
    const result = getMobileLinkRegistry(REGISTRY);
    expect(result).toHaveLength(4);
    expect(result).toEqual(REGISTRY);
  });

  it("filters by whitelist names (partial match, order follows whitelist)", () => {
    const result = getMobileLinkRegistry(REGISTRY, ["Rainbow", "MetaMask"]);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Rainbow");
    expect(result[1]!.name).toBe("MetaMask");
  });

  it("silently omits whitelist entries that have no match in registry", () => {
    const result = getMobileLinkRegistry(REGISTRY, ["Pera", "Phantom"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Pera Wallet");
  });

  it("returns an empty array when nothing on the whitelist matches", () => {
    const result = getMobileLinkRegistry(REGISTRY, ["Coinbase", "Ledger"]);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array for an empty whitelist", () => {
    const result = getMobileLinkRegistry(REGISTRY, []);
    expect(result).toHaveLength(0);
  });
});
