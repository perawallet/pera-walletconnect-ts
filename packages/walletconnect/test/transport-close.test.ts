/**
 * close() must stop the reconnect machinery, not just the live socket.
 *
 * A transport whose socket is not currently OPEN still has retry timers armed:
 * the connect timeout (for a socket wedged in CONNECTING) and the ~1s onclose
 * retry (for a socket that dropped). Before this fix, close() only closed the
 * promoted socket, so those timers kept firing _socketCreate forever — a
 * consumer that tore down a failed connection (a failed pairing, a reconnect
 * sweep, a dead bridge) leaked an immortal reconnect loop that only a process
 * restart could clear. Reconnects also back off exponentially so a dead bridge
 * is not hammered once per second.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import SocketTransport from "../src/transport/socket";

/** A controllable WebSocket stub: events fire only when the test drives them. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {
    // no-op
  }

  close() {
    this.readyState = 3;
    // Mirrors the platform: close() alone fires no onclose here. The transport
    // detaches onclose before calling close() anyway.
  }

  /** Test helper: the bridge accepted the connection. */
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Test helper: the connection dropped after opening. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function instance(i: number): FakeWebSocket {
  const socket = FakeWebSocket.instances[i];
  if (!socket) throw new Error(`expected FakeWebSocket instance ${i}`);
  return socket;
}

function makeTransport(connectTimeout = 5000) {
  return new SocketTransport({
    protocol: "wc",
    version: 1,
    url: "http://localhost:1",
    subscriptions: [],
    connectTimeout,
  });
}

describe("SocketTransport close", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("stops a socket wedged in CONNECTING from ever retrying after close()", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Handshake hangs (no open/close/error). close() must cancel the pending
    // attempt AND its connect timeout so no fresh socket is ever built.
    transport.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("stops the onclose reconnect loop after close()", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    instance(0).accept();
    instance(0).drop(); // arms the ~1s reconnect timer

    transport.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("still reconnects a transport that was NOT closed", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    instance(0).accept();
    instance(0).drop();

    vi.advanceTimersByTime(1000); // first retry: 2^0 * 1s

    expect(FakeWebSocket.instances).toHaveLength(2);
    transport.close();
  });

  it("backs off exponentially between reconnect attempts", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    instance(0).accept();
    instance(0).drop();

    vi.advanceTimersByTime(1000); // 2^0 * 1s -> attempt 2
    expect(FakeWebSocket.instances).toHaveLength(2);
    instance(1).drop();

    vi.advanceTimersByTime(1999); // 2^1 * 1s not yet elapsed
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1); // 2s reached -> attempt 3
    expect(FakeWebSocket.instances).toHaveLength(3);
    instance(2).drop();

    vi.advanceTimersByTime(3999); // 2^2 * 1s not yet elapsed
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1); // 4s reached -> attempt 4
    expect(FakeWebSocket.instances).toHaveLength(4);

    transport.close();
  });

  it("resets the backoff after a successful open", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    instance(0).accept();
    instance(0).drop();

    vi.advanceTimersByTime(1000); // attempt 2 at 2^0
    instance(1).drop();
    vi.advanceTimersByTime(2000); // attempt 3 at 2^1
    expect(FakeWebSocket.instances).toHaveLength(3);

    // The bridge comes back, then drops again: the next retry is back at 1s,
    // not the escalated delay.
    instance(2).accept();
    instance(2).drop();
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(4);
    transport.close();
  });

  it("can be reopened after close()", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport();
    transport.open();
    transport.close();

    transport.open(); // close() must not permanently disable the transport

    expect(FakeWebSocket.instances).toHaveLength(2);
    transport.close();
  });
});
