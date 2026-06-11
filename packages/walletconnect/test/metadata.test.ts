/**
 * Tests for getWindowMetadata (src/browser/metadata.ts).
 *
 * Strategy: stub the global `window` with a fake document/location that
 * implements getElementsByTagName("link" | "meta") so the function can
 * resolve name, description, url, and icons.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getWindowMetadata } from "../src/browser/metadata";

afterEach(() => vi.unstubAllGlobals());

/** Build a minimal fake link element. */
function fakeLink(attrs: Record<string, string>) {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

/** Build a minimal fake meta element. */
function fakeMeta(attrs: Record<string, string>) {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

/** Wrap an array as a fake HTMLCollection (length + numeric indexer). */
function fakeCollection(items: object[]) {
  return Object.assign(items, { length: items.length });
}

function stubWindow(opts: {
  links?: object[];
  metas?: object[];
  title?: string;
  origin?: string;
  host?: string;
  protocol?: string;
  pathname?: string;
}) {
  const {
    links = [],
    metas = [],
    title = "",
    origin = "https://example.com",
    host = "example.com",
    protocol = "https:",
    pathname = "/",
  } = opts;

  vi.stubGlobal("window", {
    document: {
      getElementsByTagName: (tag: string) => {
        if (tag === "link") return fakeCollection(links);
        if (tag === "meta") return fakeCollection(metas);
        return fakeCollection([]);
      },
      title,
    },
    location: { origin, host, protocol, pathname },
  });
}

describe("getWindowMetadata", () => {
  it("returns null when window is not available", () => {
    // Node environment – window is not defined (no stub)
    expect(getWindowMetadata()).toBeNull();
  });

  it("returns basic metadata from meta tags", () => {
    stubWindow({
      metas: [
        fakeMeta({ name: "name", content: "My DApp" }),
        fakeMeta({ name: "description", content: "A test app" }),
      ],
      origin: "https://dapp.example.com",
    });
    const meta = getWindowMetadata();
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("My DApp");
    expect(meta!.description).toBe("A test app");
    expect(meta!.url).toBe("https://dapp.example.com");
  });

  it("falls back to document.title when no name meta tag", () => {
    stubWindow({ title: "Page Title", origin: "https://dapp.example.com" });
    const meta = getWindowMetadata();
    expect(meta!.name).toBe("Page Title");
  });

  it("picks up og:title when name meta is absent", () => {
    stubWindow({
      metas: [fakeMeta({ property: "og:title", content: "OG Title" })],
    });
    const meta = getWindowMetadata();
    expect(meta!.name).toBe("OG Title");
  });

  it("picks up og:description", () => {
    stubWindow({
      metas: [
        fakeMeta({ name: "name", content: "App" }),
        fakeMeta({ property: "og:description", content: "OG Desc" }),
      ],
    });
    const meta = getWindowMetadata();
    expect(meta!.description).toBe("OG Desc");
  });

  it("resolves an absolute icon href unchanged", () => {
    stubWindow({
      links: [fakeLink({ rel: "icon", href: "https://cdn.example.com/icon.png" })],
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toEqual(["https://cdn.example.com/icon.png"]);
  });

  it("resolves a protocol-relative icon href by prepending protocol", () => {
    stubWindow({
      links: [fakeLink({ rel: "icon", href: "//cdn.example.com/icon.png" })],
      protocol: "https:",
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toEqual(["https://cdn.example.com/icon.png"]);
  });

  it("resolves an absolute-path icon href to protocol+host+path", () => {
    stubWindow({
      links: [fakeLink({ rel: "icon", href: "/assets/icon.png" })],
      protocol: "https:",
      host: "myapp.example.com",
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toEqual(["https://myapp.example.com/assets/icon.png"]);
  });

  it("resolves a relative icon href relative to the current pathname", () => {
    stubWindow({
      links: [fakeLink({ rel: "icon", href: "icon.png" })],
      protocol: "https:",
      host: "myapp.example.com",
      pathname: "/subdir/page.html",
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toEqual(["https://myapp.example.com/subdir/icon.png"]);
  });

  it("ignores link elements without rel containing 'icon'", () => {
    stubWindow({
      links: [
        fakeLink({ rel: "stylesheet", href: "style.css" }),
        fakeLink({ rel: "shortcut icon", href: "https://example.com/favicon.ico" }),
      ],
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toHaveLength(1);
    expect(meta!.icons[0]).toBe("https://example.com/favicon.ico");
  });

  it("ignores link elements without href", () => {
    stubWindow({
      links: [fakeLink({ rel: "icon" })], // no href
    });
    const meta = getWindowMetadata();
    expect(meta!.icons).toHaveLength(0);
  });

  it("returns empty icons array when no icon links exist", () => {
    stubWindow({});
    const meta = getWindowMetadata();
    expect(meta!.icons).toEqual([]);
  });

  it("returns the origin as url", () => {
    stubWindow({ origin: "https://wallet.pera.app" });
    const meta = getWindowMetadata();
    expect(meta!.url).toBe("https://wallet.pera.app");
  });
});
