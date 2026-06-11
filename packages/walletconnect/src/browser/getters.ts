export function getFromWindow<T>(name: string): T | undefined {
  let res: T | undefined = undefined;
  // oxlint-disable-next-line typescript/no-explicit-any -- legacy dynamic window lookup
  if (typeof window !== "undefined" && typeof (window as any)[name] !== "undefined") {
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy dynamic window lookup
    res = (window as any)[name];
  }
  return res;
}

export function getFromWindowOrThrow<T>(name: string): T {
  const res = getFromWindow<T>(name);
  if (!res) {
    throw new Error(`${name} is not defined in Window`);
  }
  return res;
}

export const getDocument = () => getFromWindow<Document>("document");
export const getDocumentOrThrow = () => getFromWindowOrThrow<Document>("document");
export const getNavigator = () => getFromWindow<Navigator>("navigator");
export const getNavigatorOrThrow = () => getFromWindowOrThrow<Navigator>("navigator");
export const getLocation = () => getFromWindow<Location>("location");
export const getLocationOrThrow = () => getFromWindowOrThrow<Location>("location");
export const getCrypto = () => getFromWindow<Crypto>("crypto");
export const getCryptoOrThrow = () => getFromWindowOrThrow<Crypto>("crypto");
export const getLocalStorage = () => getFromWindow<Storage>("localStorage");
export const getLocalStorageOrThrow = () => getFromWindowOrThrow<Storage>("localStorage");
