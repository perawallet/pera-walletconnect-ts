/**
 * Hung-handshake recovery. A WebSocket suspended mid-CONNECTING (OS freezes
 * the app during a handshake) can fire no event at all — without a connect
 * timeout, _nextSocket stays occupied forever and every later _socketCreate
 * is a no-op: the transport is permanently wedged and messages queue into it
 * until the process dies.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import SocketTransport from "../src/transport/socket";

/** Stays CONNECTING forever and never fires a single event. */
class HungWebSocket {
  static instances: HungWebSocket[] = [];

  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    HungWebSocket.instances.push(this);
  }

  send() {
    // never connected — nothing to send to
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    // deliberately does NOT fire onclose: the platform gave up on this
    // socket entirely, which is exactly the wedge scenario
  }
}

describe("SocketTransport connect timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    HungWebSocket.instances = [];
  });

  it("abandons a socket stuck in CONNECTING and starts a fresh attempt", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", HungWebSocket);

    const transport = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: "http://localhost:1",
      subscriptions: [],
      connectTimeout: 5000,
    });
    transport.open();

    expect(HungWebSocket.instances).toHaveLength(1);

    // handshake hangs: no open, no error, no close
    vi.advanceTimersByTime(4999);
    expect(HungWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2);
    expect(HungWebSocket.instances[0]?.closed).toBe(true);
    expect(HungWebSocket.instances).toHaveLength(2);
  });

  it("does not fire the connect timeout once the socket opened", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", HungWebSocket);

    const transport = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: "http://localhost:1",
      subscriptions: [],
      connectTimeout: 5000,
    });
    transport.open();

    const socket = HungWebSocket.instances[0];
    if (!socket) throw new Error("expected a socket instance");
    socket.readyState = 1;
    socket.onopen?.();

    vi.advanceTimersByTime(60_000);
    expect(socket.closed).toBe(false);
    expect(HungWebSocket.instances).toHaveLength(1);
  });
});
