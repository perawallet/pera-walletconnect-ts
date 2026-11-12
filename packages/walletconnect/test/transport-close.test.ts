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
import NetworkMonitor from "../src/transport/network";

/** A controllable WebSocket stub: events fire only when the test drives them. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
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

  /** Test helper: the handshake failed (bridge unreachable). */
  fail() {
    this.readyState = 3;
    this.onerror?.(new Error("connect failed"));
    this.onclose?.();
  }

  /** Test helper: the bridge delivered a frame on this socket. */
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(type?: string): { topic: string; type: string; payload: string }[] {
    return this.sent
      .map(message => JSON.parse(message))
      .filter(frame => type === undefined || frame.type === type);
  }
}

function instance(i: number): FakeWebSocket {
  const socket = FakeWebSocket.instances[i];
  if (!socket) throw new Error(`expected FakeWebSocket instance ${i}`);
  return socket;
}

function makeTransport(connectTimeout = 5000, subscriptions: string[] = []) {
  return new SocketTransport({
    protocol: "wc",
    version: 1,
    url: "http://localhost:1",
    subscriptions,
    connectTimeout,
  });
}

function openSockets(): FakeWebSocket[] {
  return FakeWebSocket.instances.filter(socket => socket.readyState === 1);
}

function deferred() {
  let resolve: () => void = () => {
    // replaced below
  };
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets promise callbacks queued by the code under test run. */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
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

describe("SocketTransport reconnect races", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("does not let the retry timer orphan an attempt that send() started inside the backoff window", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(10_000, ["client-topic"]);
    transport.open();
    instance(0).accept();
    instance(0).drop(); // arms the 1s retry with no attempt in flight

    vi.advanceTimersByTime(300);
    transport.send("sign-request", "peer-topic");
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The retry timer fires while the send-triggered attempt is still in its
    // handshake: it must neither forget that attempt nor start a second one.
    vi.advanceTimersByTime(700);
    expect(FakeWebSocket.instances).toHaveLength(2);

    instance(1).accept();

    expect(transport.connected).toBe(true);
    expect(instance(1).frames("pub")).toMatchObject([{ topic: "peer-topic" }]);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(openSockets()).toEqual([instance(1)]);
    transport.close();
  });

  it("does not let a stale retry timer replace a socket that already reconnected", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(10_000, ["client-topic"]);
    transport.open();
    instance(0).accept();
    instance(0).drop();

    vi.advanceTimersByTime(300);
    transport.send("sign-request", "peer-topic");
    vi.advanceTimersByTime(400);
    instance(1).accept(); // reconnected before the dropped socket's retry is due

    vi.advanceTimersByTime(60_000);

    // A replacement socket would re-send every sub frame, and the bridge
    // replays a topic's pending history once per sub frame it receives.
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(instance(1).frames("sub")).toHaveLength(1);
    expect(transport.connected).toBe(true);
    transport.close();
  });

  it("closes, instead of promoting, an attempt that opens after it was superseded", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(10_000, ["client-topic"]);
    transport.open();
    // No public path leads here; the state is forced through private fields to
    // pin the defensive check that only the current attempt may be promoted.
    // oxlint-disable-next-line typescript/no-explicit-any -- forcing a superseded attempt
    (transport as any)._nextSocket = null;
    transport.send("sign-request", "peer-topic");
    expect(FakeWebSocket.instances).toHaveLength(2);

    instance(0).accept();

    expect(instance(0).readyState).toBe(3);
    expect(instance(0).frames()).toEqual([]);
    expect(transport.connected).toBe(false);

    instance(1).accept();
    expect(transport.connected).toBe(true);
    expect(instance(1).frames("pub")).toHaveLength(1);
    transport.close();
  });
});

describe("SocketTransport online event", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  function makeMonitoredTransport() {
    const netMonitor = new NetworkMonitor();
    const transport = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: "http://localhost:1",
      subscriptions: [],
      connectTimeout: 10_000,
      netMonitor,
    });
    return { transport, netMonitor };
  }

  /** Fails five handshakes in a row, leaving the next retry 16s away. */
  function failFiveAttempts() {
    instance(0).fail();
    for (const [next, delay] of [
      [1, 1000],
      [2, 2000],
      [3, 4000],
      [4, 8000],
    ] as const) {
      vi.advanceTimersByTime(delay);
      instance(next).fail();
    }
    expect(FakeWebSocket.instances).toHaveLength(5);
  }

  it("reconnects at once when the network comes back during a long backoff", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { transport, netMonitor } = makeMonitoredTransport();
    transport.open();
    failFiveAttempts();

    transport.send("sign-request", "peer-topic");
    expect(FakeWebSocket.instances).toHaveLength(5); // backoff still holds sends back

    netMonitor.trigger("online");

    expect(FakeWebSocket.instances).toHaveLength(6);
    instance(5).accept();
    expect(instance(5).frames("pub")).toMatchObject([{ topic: "peer-topic" }]);

    // The cleared backoff timer must not fire later and replace the socket.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(6);
    expect(transport.connected).toBe(true);
    transport.close();
  });

  it("restarts the backoff after an online-triggered attempt fails", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { transport, netMonitor } = makeMonitoredTransport();
    transport.open();
    failFiveAttempts();

    netMonitor.trigger("online");
    instance(5).fail();

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(7);
    transport.close();
  });

  it("leaves an attempt that is still connecting alone", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { transport, netMonitor } = makeMonitoredTransport();
    transport.open();

    netMonitor.trigger("online");

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(instance(0).readyState).toBe(0);
    transport.close();
  });

  it("creates nothing after close()", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { transport, netMonitor } = makeMonitoredTransport();
    transport.open();
    failFiveAttempts();
    transport.close();

    netMonitor.trigger("online");
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(5);
  });

  it("keeps an open socket when the network changes", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { transport, netMonitor } = makeMonitoredTransport();
    transport.open();
    instance(0).accept();
    expect(transport.connected).toBe(true);

    // e.g. wifi to cellular while the socket stays up: a new socket would
    // resend every sub frame, and the bridge replays pending history per sub.
    netMonitor.trigger("online");
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(instance(0).readyState).toBe(1);
    transport.close();
  });
});

describe("SocketTransport close with frames still to send", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("delivers publishes queued while the socket was down on a one-shot socket", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    const events: string[] = [];
    for (const name of ["open", "close", "error"]) transport.on(name, () => events.push(name));
    transport.open();
    instance(0).fail(); // bridge unreachable: the retry waits 1s
    events.length = 0;
    transport.subscribe("handshake-topic");
    transport.send("kill-session", "peer-topic");

    transport.close();

    expect(FakeWebSocket.instances).toHaveLength(2);
    const drain = instance(1);
    drain.accept();

    // Subscribing would make the bridge replay, and so lose, messages meant
    // for whatever replaces this transport.
    expect(drain.frames()).toMatchObject([{ type: "pub", topic: "peer-topic" }]);
    expect(drain.readyState).toBe(3);
    expect(transport.connected).toBe(false);
    expect(events).toEqual([]);

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not ack or dispatch frames arriving on the one-shot socket", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    const received: unknown[] = [];
    transport.on("message", message => received.push(message));
    transport.open();
    transport.send("kill-session", "peer-topic");
    transport.close();

    const drain = instance(1);
    drain.receive({ topic: "client-topic", type: "pub", payload: "late", silent: true });
    drain.accept();

    expect(received).toEqual([]);
    expect(drain.frames("ack")).toEqual([]);
  });

  it("gives up on the one-shot socket after the connect timeout without reporting a transport error", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000);
    const events: string[] = [];
    for (const name of ["open", "close", "error", "undelivered"]) {
      transport.on(name, () => events.push(name));
    }
    transport.open();
    transport.send("kill-session", "peer-topic");
    transport.close();
    events.length = 0;

    vi.advanceTimersByTime(5000); // handshake never completes

    expect(instance(1).readyState).toBe(3);
    expect(events).toEqual(["undelivered"]);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("reports a failed one-shot socket only as undelivered and never retries it", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000);
    const events: string[] = [];
    for (const name of ["open", "close", "error", "undelivered"]) {
      transport.on(name, () => events.push(name));
    }
    transport.open();
    transport.send("kill-session", "peer-topic");
    transport.close();
    events.length = 0;

    instance(1).fail();
    vi.advanceTimersByTime(60_000);

    expect(events).toEqual(["undelivered"]);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("opens no socket for a send made after close() with nothing queued", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    transport.open();
    instance(0).fail();
    transport.close();

    transport.send("late", "peer-topic");
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("SocketTransport closeAfter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("sends on the open socket until the pending work settles, then closes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    transport.open();
    instance(0).accept();
    const pending = deferred();

    transport.closeAfter(pending.promise);
    transport.send("reject-session", "peer-topic");
    expect(instance(0).frames("pub")).toMatchObject([{ topic: "peer-topic" }]);

    pending.resolve();
    await flushMicrotasks();

    expect(instance(0).readyState).toBe(3);
    expect(transport.connected).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("neither acks nor dispatches inbound frames while closing", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    const received: unknown[] = [];
    transport.on("message", message => received.push(message));
    transport.open();
    instance(0).accept();

    transport.closeAfter(deferred().promise);
    instance(0).receive({ topic: "client-topic", type: "pub", payload: "late", silent: true });

    expect(received).toEqual([]);
    expect(instance(0).frames("ack")).toEqual([]);
    transport.close();
  });

  it("builds no socket and sends no sub frame while closing with the socket down", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const netMonitor = new NetworkMonitor();
    const transport = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: "http://localhost:1",
      subscriptions: ["client-topic"],
      connectTimeout: 5000,
      netMonitor,
    });
    transport.open();
    instance(0).accept();
    instance(0).drop(); // retry armed for 1s
    const pending = deferred();

    transport.closeAfter(pending.promise);
    transport.send("reject-session", "peer-topic");
    netMonitor.trigger("online");
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    pending.resolve();
    await flushMicrotasks();

    // The real close() hands the queued publish to the one-shot socket.
    expect(FakeWebSocket.instances).toHaveLength(2);
    instance(1).accept();
    expect(instance(1).frames()).toMatchObject([{ type: "pub", topic: "peer-topic" }]);
    expect(FakeWebSocket.instances.flatMap(socket => socket.frames("sub"))).toHaveLength(1);
  });

  it("drops an in-flight attempt when closing starts", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    transport.open(); // attempt still CONNECTING

    transport.closeAfter(deferred().promise);
    expect(instance(0).readyState).toBe(3);

    instance(0).accept(); // a platform that still completes the handshake
    expect(instance(0).frames()).toEqual([]);
    expect(transport.connected).toBe(false);
    transport.close();
  });

  it("is cancelled by open() before the pending work settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    transport.open();
    instance(0).accept();
    const pending = deferred();

    transport.closeAfter(pending.promise);
    transport.open();
    instance(1).accept();
    pending.resolve();
    await flushMicrotasks();

    expect(transport.connected).toBe(true);
    expect(instance(1).readyState).toBe(1);
    transport.close();
  });

  it("waits for the work of the latest closeAfter when they overlap", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    transport.open();
    instance(0).accept();
    const first = deferred();
    const second = deferred();

    transport.closeAfter(first.promise);
    transport.closeAfter(second.promise);
    first.resolve();
    await flushMicrotasks();
    transport.send("approve-request", "peer-topic");

    expect(instance(0).frames("pub")).toMatchObject([{ topic: "peer-topic" }]);
    expect(transport.connected).toBe(true);

    second.resolve();
    await flushMicrotasks();

    expect(transport.connected).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("reports queued publishes as undelivered when no socket can be built for them", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000, ["client-topic"]);
    const undelivered: unknown[] = [];
    transport.on("undelivered", frames => undelivered.push(frames));
    transport.open();
    instance(0).accept();
    instance(0).drop();
    const pending = deferred();

    transport.closeAfter(pending.promise);
    transport.send("kill-session", "peer-topic");
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("WebSocket blocked");
        }
      },
    );
    pending.resolve();
    await flushMicrotasks();

    expect(undelivered).toMatchObject([[{ type: "pub", topic: "peer-topic" }]]);
    expect(transport.connected).toBe(false);
  });
});

describe("SocketTransport repeated close", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("does not carry out a send made after the first close()", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const transport = makeTransport(5000);
    transport.open();
    instance(0).fail();
    transport.close();

    transport.send("late", "peer-topic");
    transport.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
