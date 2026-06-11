import type { ISessionStorage, IWalletConnectSession } from "../types";
import { getLocal, removeLocal, setLocal } from "../browser/local";
import { isWalletConnectSession } from "../utils/uri";

class SessionStorage implements ISessionStorage {
  constructor(public storageId: string = "walletconnect") {}

  public getSession(): IWalletConnectSession | null {
    let session: IWalletConnectSession | null = null;
    const json = getLocal(this.storageId);
    if (json && isWalletConnectSession(json)) {
      session = json;
    }
    return session;
  }

  public setSession(session: IWalletConnectSession): IWalletConnectSession {
    setLocal(this.storageId, session);
    return session;
  }

  public removeSession(): void {
    removeLocal(this.storageId);
  }
}

export default SessionStorage;
