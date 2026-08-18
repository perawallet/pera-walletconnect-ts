import type {
  INetworkMonitor,
  ISocketMessage,
  ISocketTransportOptions,
  ITransportEvent,
  ITransportLib,
} from "../types";
import { isBrowser, detectEnv } from "../browser/env";
import { getLocation } from "../browser/getters";
import { appendToQueryString, getQueryString } from "../utils/uri";
import NetworkMonitor from "./network";

// native WebSocket only (browsers, React Native, Node >= 22):
function getWebSocketClass(): typeof WebSocket {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  throw new Error(
    "No WebSocket implementation found. Browsers, React Native, and Node.js >= 22 " +
      "provide one natively; upgrade Node or expose a global WebSocket.",
  );
}

// -- SocketTransport ------------------------------------------------------ //

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

class SocketTransport implements ITransportLib {
  private _protocol: string;
  private _version: number;
  private _url: string;
  private _netMonitor: INetworkMonitor | null;
  private _socket: WebSocket | null;
  private _nextSocket: WebSocket | null;
  private _queue: ISocketMessage[] = [];
  private _events: ITransportEvent[] = [];
  private _subscriptions: string[] = [];
  private _connectTimeout: number;

  // -- constructor ----------------------------------------------------- //

  constructor(private opts: ISocketTransportOptions) {
    this._protocol = opts.protocol;
    this._version = opts.version;
    this._url = "";
    this._netMonitor = null;
    this._socket = null;
    this._nextSocket = null;
    this._subscriptions = opts.subscriptions || [];
    this._connectTimeout = opts.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._netMonitor = opts.netMonitor || new NetworkMonitor();

    if (!opts.url || typeof opts.url !== "string") {
      throw new Error("Missing or invalid WebSocket url");
    }

    this._url = opts.url;

    this._netMonitor.on("online", () => this._socketCreate());
  }

  set readyState(value) {
    // empty
  }

  get readyState(): number {
    return this._socket ? this._socket.readyState : -1;
  }

  set connecting(value) {
    // empty
  }

  get connecting(): boolean {
    return this.readyState === 0;
  }

  set connected(value) {
    // empty
  }

  get connected(): boolean {
    return this.readyState === 1;
  }

  set closing(value) {
    // empty
  }

  get closing(): boolean {
    return this.readyState === 2;
  }

  set closed(value) {
    // empty
  }

  get closed(): boolean {
    return this.readyState === 3;
  }

  // -- public ---------------------------------------------------------- //

  public open() {
    this._socketCreate();
  }

  public close() {
    this._socketClose();
  }

  public send(message: string, topic?: string, silent?: boolean): void {
    if (!topic || typeof topic !== "string") {
      throw new Error("Missing or invalid topic field");
    }

    this._socketSend({
      topic: topic,
      type: "pub",
      payload: message,
      silent: !!silent,
    });
  }

  public subscribe(topic: string) {
    // Track the topic so a reconnect re-subscribes it; a one-shot sub frame
    // would leave the topic deaf after any socket drop (the wallet's
    // handshake topic arrives through here, not the constructor).
    // Already-tracked topics send nothing: the bridge replays a topic's
    // whole pending history on EVERY sub frame it receives, so a repeat
    // frame means duplicate message delivery — and reconnect re-subscription
    // is _queueSubscriptions' job, not this one's.
    if (this._subscriptions.includes(topic)) {
      return;
    }
    this._subscriptions.push(topic);

    this._socketSend({
      topic: topic,
      type: "sub",
      payload: "",
      silent: true,
    });
  }

  // oxlint-disable-next-line typescript/no-explicit-any -- legacy transport event API is untyped
  public on(event: string, callback: (payload: any) => void) {
    this._events.push({ event, callback });
  }

  // -- private ---------------------------------------------------------- //

  private _socketCreate() {
    if (this._nextSocket) {
      return;
    }

    const url = getWebSocketUrl(this._url, this._protocol, this._version);

    this._nextSocket = new (getWebSocketClass())(url);

    if (!this._nextSocket) {
      throw new Error("Failed to create socket");
    }

    const socket = this._nextSocket;

    // A handshake the platform silently gave up on (no open/error/close —
    // e.g. the OS suspended the app mid-connect) would occupy _nextSocket
    // forever and wedge every future _socketCreate. Force-fail it ourselves:
    // detach the handlers first so a late platform close can't double-run
    // the retry path.
    const connectTimer = setTimeout(() => {
      if (this._nextSocket !== socket) {
        return;
      }
      socket.onopen = () => {
        // abandoned attempt
      };
      socket.onclose = () => {
        // abandoned attempt
      };
      try {
        socket.close();
      } catch (_error) {
        // closing a CONNECTING socket is best-effort on some platforms
      }
      this._nextSocket = null;
      this._socketCreate();
    }, this._connectTimeout);

    socket.onmessage = (event: MessageEvent) => this._socketReceive(event);

    socket.onopen = () => {
      clearTimeout(connectTimer);
      this._socketOpen();
    };

    socket.onerror = (event: Event) => this._socketError(event);

    socket.onclose = () => {
      clearTimeout(connectTimer);
      // An unexpected close of the PROMOTED socket is a transport-level
      // close; a _nextSocket close is just a failed connection attempt.
      if (this._socket === socket) {
        this._dispatchEvent("close");
      }
      setTimeout(() => {
        this._nextSocket = null;
        this._socketCreate();
      }, 1000);
    };
  }

  private _socketOpen() {
    // Silent replacement: swapping a stale socket for the fresh one is not a
    // transport-level close, so no "close" event fires here.
    this._socketClose(true);
    this._socket = this._nextSocket;
    this._nextSocket = null;
    this._queueSubscriptions();
    this._pushQueue();
    this._dispatchEvent("open");
  }

  private _socketClose(silent = false) {
    if (this._socket) {
      this._socket.onclose = () => {
        // empty
      };
      this._socket.close();
      if (!silent) {
        this._dispatchEvent("close");
      }
    }
  }

  private _socketSend(socketMessage: ISocketMessage) {
    const message: string = JSON.stringify(socketMessage);

    if (this._socket && this._socket.readyState === 1) {
      this._socket.send(message);
    } else {
      this._setToQueue(socketMessage);
      this._socketCreate();
    }
  }

  private async _socketReceive(event: MessageEvent) {
    let socketMessage: ISocketMessage;

    try {
      socketMessage = JSON.parse(event.data);
    } catch (_error) {
      return;
    }

    this._socketSend({
      topic: socketMessage.topic,
      type: "ack",
      payload: "",
      silent: true,
    });

    // Dispatch unconditionally: this frame was already acked, and the bridge
    // deletes cached messages at flush time — gating on the CURRENT socket
    // state (which may have died since receipt) would drop it forever.
    const events = this._events.filter(event => event.event === "message");
    if (events && events.length) {
      events.forEach(event => event.callback(socketMessage));
    }
  }

  private _socketError(e: Event) {
    this._dispatchEvent("error", e);
  }

  // oxlint-disable-next-line typescript/no-explicit-any -- legacy transport event API is untyped
  private _dispatchEvent(name: string, payload?: any) {
    const events = this._events.filter(event => event.event === name);
    if (events && events.length) {
      events.forEach(event => event.callback(payload));
    }
  }

  private _queueSubscriptions() {
    // Every tracked topic — constructor-provided and dynamically subscribed —
    // is re-queued on each (re)open. No reset: dropping back to
    // opts.subscriptions here is what used to lose dynamic topics.
    this._subscriptions.forEach((topic: string) =>
      this._setToQueue({
        topic: topic,
        type: "sub",
        payload: "",
        silent: true,
      }),
    );
  }

  private _setToQueue(socketMessage: ISocketMessage) {
    // One sub frame per topic per flush: a subscribe() issued while the
    // socket was CONNECTING already queued this topic, and the bridge
    // replays the topic's pending history once per frame it receives.
    if (
      socketMessage.type === "sub" &&
      this._queue.some(queued => queued.type === "sub" && queued.topic === socketMessage.topic)
    ) {
      return;
    }
    this._queue.push(socketMessage);
  }

  private _pushQueue() {
    // Swap the queue out before draining: a send that fails mid-flush
    // re-queues its frame via _setToQueue, and that frame must land in the
    // fresh queue — clearing after the loop would wipe it.
    const queue = this._queue;
    this._queue = [];

    queue.forEach((socketMessage: ISocketMessage) => this._socketSend(socketMessage));
  }
}

function getWebSocketUrl(_url: string, protocol: string, version: number): string {
  const url = _url.startsWith("https")
    ? _url.replace("https", "wss")
    : _url.startsWith("http")
      ? _url.replace("http", "ws")
      : _url;
  const splitUrl = url.split("?");
  const params = isBrowser()
    ? {
        protocol,
        version,
        env: "browser",
        host: getLocation()?.host || "",
      }
    : {
        protocol,
        version,
        env: detectEnv()?.name || "",
      };
  const queryString = appendToQueryString(getQueryString(splitUrl[1] || ""), params);
  return splitUrl[0] + "?" + queryString;
}

export default SocketTransport;
