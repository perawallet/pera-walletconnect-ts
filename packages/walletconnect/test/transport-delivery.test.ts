/**
 * Delivery integrity under socket churn. These two windows can't be hit
 * deterministically through a live socket (they require the socket to die
 * between two adjacent statements), so the tests reach into the transport's
 * private state to freeze the exact moment each bug occupies.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import SocketTransport from "../src/transport/socket";
import { MockBridge } from "./mock-bridge";
import type { ISocketMessage } from "../src/types";

describe("SocketTransport delivery integrity", () => {
  let bridge: MockBridge;
  let transports: SocketTransport[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    for (const t of transports) t.close();
    transports = [];
    await bridge.close();
  });

  function makeTransport(subscriptions: string[] = []) {
    const t = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: bridge.url,
      subscriptions,
    });
    transports.push(t);
    return t;
  }

  it("dispatches a received frame even when the socket went stale before dispatch", async () => {
    // A frame the bridge already delivered (and the transport acked) must
    // reach message listeners even if the socket died in between — dropping
    // it loses the frame forever: the bridge deleted it at flush time.
    const transport = makeTransport([]);
    const received: unknown[] = [];
    transport.on("message", msg => received.push(msg));

    const frame: ISocketMessage = {
      topic: "handshake-topic",
      type: "pub",
      payload: "session-request",
      silent: true,
    };

    // No open socket at dispatch time (transport never opened).
    // oxlint-disable-next-line typescript/no-explicit-any -- reaching private state to freeze the race window
    await (transport as any)._socketReceive({ data: JSON.stringify(frame) });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ topic: "handshake-topic", payload: "session-request" });
  });

  it("re-queues frames whose send failed mid-flush instead of wiping them", () => {
    // If the socket dies while _pushQueue drains, the failed sends re-queue
    // themselves — the flush must not clobber those re-queued frames.
    const transport = makeTransport([]);

    const sent: string[] = [];
    const fakeSocket = {
      readyState: 1,
      onclose: () => {
        // set by the transport during teardown
      },
      send(message: string) {
        sent.push(message);
        // socket dies after the first successful send
        this.readyState = 3;
      },
      close() {
        this.readyState = 3;
      },
    };

    const frameA: ISocketMessage = { topic: "t", type: "pub", payload: "A", silent: true };
    const frameB: ISocketMessage = { topic: "t", type: "pub", payload: "B", silent: true };

    // oxlint-disable-next-line typescript/no-explicit-any -- reaching private state to freeze the race window
    const internals = transport as any;
    internals._socket = fakeSocket;
    internals._queue = [frameA, frameB];

    internals._pushQueue();

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] ?? "")).toMatchObject({ payload: "A" });
    // frame B failed to send and must survive in the queue for the next open
    expect(internals._queue).toHaveLength(1);
    expect(internals._queue[0]).toMatchObject({ payload: "B" });
  });
});
