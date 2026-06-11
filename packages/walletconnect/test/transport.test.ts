import { describe, it, expect, beforeEach, afterEach } from "vitest";
import SocketTransport from "../src/transport/socket";
import { MockBridge } from "./mock-bridge";

function waitFor<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const result = check();
      if (result !== undefined) {
        clearInterval(interval);
        resolve(result);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 25);
  });
}

describe("SocketTransport", () => {
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

  it("throws on missing url", () => {
    expect(
      () => new SocketTransport({ protocol: "wc", version: 1, url: "" as string }),
    ).toThrowError(/url/i);
  });

  it("converts http(s) URLs to ws(s) and appends env params", async () => {
    const t = makeTransport(["topicA"]);
    t.open();
    await waitFor(() => (bridge.messages.some(m => m.type === "sub") ? true : undefined));
    expect(bridge.messages[0]).toMatchObject({ topic: "topicA", type: "sub", silent: true });
  });

  it("delivers pub messages to subscribers and acks", async () => {
    const a = makeTransport(["alice"]);
    const received: unknown[] = [];
    a.on("message", msg => received.push(msg));
    a.open();
    await waitFor(() => (bridge.messages.some(m => m.type === "sub") ? true : undefined));

    const b = makeTransport([]);
    b.open();
    b.send("hello", "alice", true);
    const msg = await waitFor(() => received[0]);
    expect(msg).toMatchObject({ topic: "alice", type: "pub", payload: "hello" });
    // transport acks every received message
    await waitFor(() =>
      bridge.messages.some(m => m.type === "ack" && m.topic === "alice") ? true : undefined,
    );
  });

  it("queues sends until the socket opens", async () => {
    const t = makeTransport([]);
    t.send("queued", "sometopic", true); // send before open: must queue + auto-create socket
    await waitFor(() =>
      bridge.messages.some(m => m.type === "pub" && m.payload === "queued") ? true : undefined,
    );
  });

  it("throws when sending without a topic", () => {
    const t = makeTransport([]);
    expect(() => t.send("x")).toThrowError(/topic/i);
  });

  it("delivers messages published before the subscriber arrives (bridge cache flush)", async () => {
    // The WC v1 session handshake relies on this: the dapp publishes the
    // session request to the handshake topic before the wallet subscribes.
    const publisher = makeTransport([]);
    publisher.open();
    publisher.send("early-bird", "late-topic", true);
    await waitFor(() =>
      bridge.messages.some(m => m.type === "pub" && m.payload === "early-bird") ? true : undefined,
    );

    const subscriber = makeTransport(["late-topic"]);
    const received: unknown[] = [];
    subscriber.on("message", msg => received.push(msg));
    subscriber.open();
    const msg = await waitFor(() => received[0]);
    expect(msg).toMatchObject({ topic: "late-topic", type: "pub", payload: "early-bird" });
  });
});
