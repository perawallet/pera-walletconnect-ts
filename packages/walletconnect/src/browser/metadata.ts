import type { IClientMeta } from "../types";
import { getDocumentOrThrow, getLocationOrThrow } from "./getters";

export function getWindowMetadata(): IClientMeta | null {
  let doc: Document;
  let loc: Location;
  try {
    doc = getDocumentOrThrow();
    loc = getLocationOrThrow();
  } catch {
    return null;
  }

  function getIcons(): string[] {
    const links = doc.getElementsByTagName("link");
    const icons: string[] = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i]!;
      const rel = link.getAttribute("rel");
      if (rel && rel.toLowerCase().includes("icon")) {
        const href = link.getAttribute("href");
        if (href) {
          if (!href.startsWith("https:") && !href.startsWith("http:") && !href.startsWith("//")) {
            const path = href.startsWith("/")
              ? loc.protocol + "//" + loc.host + href
              : loc.protocol + "//" + loc.host + loc.pathname.replace(/\/[^/]*$/, "/") + href;
            icons.push(path);
          } else if (href.startsWith("//")) {
            icons.push(loc.protocol + href);
          } else {
            icons.push(href);
          }
        }
      }
    }
    return icons;
  }

  function getMetaOfAny(...args: string[]): string {
    const metaTags = doc.getElementsByTagName("meta");
    for (let i = 0; i < metaTags.length; i++) {
      const tag = metaTags[i]!;
      const attributes = ["itemprop", "property", "name"]
        .map(target => tag.getAttribute(target))
        .filter(attr => (attr ? args.includes(attr) : false));
      if (attributes.length && attributes[0]) {
        const content = tag.getAttribute("content");
        if (content) {
          return content;
        }
      }
    }
    return "";
  }

  const name = getMetaOfAny("name", "og:site_name", "og:title", "twitter:title") || doc.title;
  const description = getMetaOfAny(
    "description",
    "og:description",
    "twitter:description",
    "keywords",
  );

  return { description, url: loc.origin, icons: getIcons(), name };
}

export function getClientMeta(): IClientMeta | null {
  return getWindowMetadata();
}
