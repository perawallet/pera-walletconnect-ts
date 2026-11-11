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
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

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
  private _closed = false;
  private _closing = false;
  private _generation = 0;
  private _reconnectAttempts = 0;
  // Keyed by the socket whose close armed the timer: several can be pending
  // at once (a dropped promoted socket and a failed attempt), and the online
  // handler must find the one that belongs to the current attempt.
  private _retryTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();

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

    this._netMonitor.on("online", () => this._handleOnline());
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
    this._closed = false;
    this._closing = false;
    this._generation++;
    this._socketCreate();
  }

  public close() {
    // Stop the reconnect machinery, not just the promoted socket. A socket
    // that never opened (still CONNECTING, or already scheduled to retry after
    // a drop) has its connect-timeout and onclose retries armed; _socketClose
    // only touches the promoted socket, so without the _closed flag those
    // timers keep calling _socketCreate forever. That leaked an immortal
    // reconnect loop every time a consumer tore down a failed connection —
    // clearable only by killing the process.
    const wasClosed = this._closed;
    this._closed = true;
    this._closing = false;
    this._clearRetryTimers();
    this._dropNextSocket();
    this._socketClose();
    // Only what was queued while the transport was live: a send made after
    // close() must still open no socket, even if close() is called again.
    if (!wasClosed) {
      this._drainQueuedPublishes();
    }
  }

  /**
   * Closes once `pending` settles, so frames handed to send() before then
   * still leave on the socket that is open now. Until then the transport
   * behaves as closed for everything else: it builds no socket, subscribes
   * nothing and neither acks nor dispatches inbound frames, because a
   * transport being torn down must not take messages meant for whatever
   * replaces it. open() cancels the pending close, and a later closeAfter()
   * replaces it: the later call is the one that knows about every send made
   * so far, so closing when an earlier `pending` settles would drop the rest.
   */
  public closeAfter(pending: Promise<unknown>) {
    this._closing = true;
    this._clearRetryTimers();
    this._dropNextSocket();
    const generation = ++this._generation;
    const closeIfStillClosing = () => {
      if (this._closing && this._generation === generation) {
        this.close();
      }
    };
    pending.then(closeIfStillClosing, closeIfStillClosing);
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
    // Guards both retry paths (the connect timeout below and the onclose
    // reconnect): once close() has run, nothing may build a new socket.
    if (this._closed || this._closing || this._nextSocket) {
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

    socket.onmessage = (event: MessageEvent) => {
      if (this._closing) {
        return;
      }
      this._socketReceive(event);
    };

    socket.onopen = () => {
      clearTimeout(connectTimer);
      this._socketOpen(socket);
    };

    socket.onerror = (event: Event) => this._socketError(event);

    socket.onclose = () => {
      clearTimeout(connectTimer);
      // An unexpected close of the PROMOTED socket is a transport-level
      // close; a _nextSocket close is just a failed connection attempt.
      if (this._socket === socket) {
        this._dispatchEvent("close");
      }
      // Exponential backoff so a dead bridge is not hammered once per second
      // for the life of the app; reset on a successful open. The first retry
      // stays at the historical ~1s.
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** this._reconnectAttempts++,
        MAX_RECONNECT_DELAY_MS,
      );
      const retryTimer = setTimeout(() => {
        this._retryTimers.delete(socket);
        // Only the attempt that failed may be forgotten: a send() or 'online'
        // inside the backoff window may have started a newer one, and
        // clearing that would let a third socket be built and promoted
        // in its place.
        if (this._nextSocket === socket) {
          this._nextSocket = null;
        }
        // A newer socket that already opened makes this retry stale. Replacing
        // it would re-send every sub frame, and the bridge replays a topic's
        // pending history once per sub frame.
        if (this._socket && this._socket !== socket && this._socket.readyState === 1) {
          return;
        }
        this._socketCreate();
      }, delay);
      this._retryTimers.set(socket, retryTimer);
    };
  }

  private _handleOnline() {
    if (this._closed || this._closing) {
      return;
    }
    // The network is back, so the backoff earned while it was down no longer
    // says anything about the bridge. Waiting it out (up to 30s) would hold
    // every queued send back that long.
    const failedAttempt = this._nextSocket;
    if (failedAttempt && this._retryTimers.has(failedAttempt)) {
      this._nextSocket = null;
    }
    if (!this._nextSocket) {
      this._clearRetryTimers();
      this._reconnectAttempts = 0;
    }
    this._socketCreate();
  }

  private _clearRetryTimers() {
    this._retryTimers.forEach(timer => clearTimeout(timer));
    this._retryTimers.clear();
  }

  private _dropNextSocket() {
    // Detach first so neither its connect timeout nor its onclose handler can
    // resurrect the transport.
    if (!this._nextSocket) {
      return;
    }
    const pending = this._nextSocket;
    this._nextSocket = null;
    detachAndClose(pending);
  }

  private _socketOpen(socket: WebSocket) {
    if (socket !== this._nextSocket) {
      // Promoting the current attempt instead of the socket that opened would
      // leave a CONNECTING socket promoted and close every socket that opens
      // after it, so a superseded attempt is discarded instead.
      detachAndClose(socket);
      return;
    }
    this._reconnectAttempts = 0;
    // Silent replacement: swapping a stale socket for the fresh one is not a
    // transport-level close, so no "close" event fires here.
    this._socketClose(true);
    this._socket = socket;
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

    if (this._closing && socketMessage.type !== "pub") {
      // A sub frame would make the bridge replay, and so hand over, the
      // pending messages of a topic to a transport that is going away.
      this._setToQueue(socketMessage);
      return;
    }

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

  private _drainQueuedPublishes() {
    // Publishes queued while the socket was down (a killSession, a rejection)
    // are the last word to the peer, and closing would otherwise discard
    // them. One socket, opened once, carries them out. It never subscribes and never
    // reads, so it cannot take messages meant for a transport that replaces
    // this one, and it stays outside _socket so `connected` keeps describing
    // the closed transport.
    const frames = this._queue.filter(queued => queued.type === "pub");
    if (!frames.length) {
      return;
    }
    this._queue = this._queue.filter(queued => queued.type !== "pub");

    let socket: WebSocket;
    try {
      socket = new (getWebSocketClass())(getWebSocketUrl(this._url, this._protocol, this._version));
    } catch (_error) {
      // A close deferred behind in-flight sends has no caller left to throw
      // to, and what is lost here is exactly these frames.
      this._dispatchEvent("undelivered", frames);
      return;
    }
    let settled = false;
    const finish = (delivered: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      detachAndClose(socket);
      if (!delivered) {
        // Not "error": consumers map that to a bridge failure of a live
        // session, and this session is already over.
        this._dispatchEvent("undelivered", frames);
      }
    };
    const timer = setTimeout(() => finish(false), this._connectTimeout);
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = () => finish(false);
    socket.onopen = () => {
      frames.forEach(frame => socket.send(JSON.stringify(frame)));
      finish(true);
    };
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

function detachAndClose(socket: WebSocket) {
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  try {
    socket.close();
  } catch (_error) {
    // closing a CONNECTING socket is best-effort on some platforms
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
