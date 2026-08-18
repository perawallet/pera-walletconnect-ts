/**
 * Reconnect semantics: the transport reconnects ~1s after its socket drops,
 * re-subscribes its topics, and continues delivering. This is the network-blip
 * recovery path mobile wallets depend on.
 */

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

describe("SocketTransport reconnect", () => {
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

  it("re-subscribes after the bridge drops the connection and keeps delivering", async () => {
    const subscriber = makeTransport(["resilient-topic"]);
    const received: unknown[] = [];
    subscriber.on("message", msg => received.push(msg));
    subscriber.open();

    // initial subscription lands
    await waitFor(() => (bridge.messages.some(m => m.type === "sub") ? true : undefined));
    const subsBefore = bridge.messages.filter(m => m.type === "sub").length;

    // bridge restart: server forcibly drops every socket
    bridge.terminateAll();

    // transport reconnects after ~1s and re-subscribes the same topic
    await waitFor(
      () =>
        bridge.messages.filter(m => m.type === "sub" && m.topic === "resilient-topic").length >
        subsBefore
          ? true
          : undefined,
      8000,
    );

    // a message published after the reconnect is delivered
    const publisher = makeTransport([]);
    publisher.open();
    publisher.send("after-restart", "resilient-topic", true);
    const msg = await waitFor(() => received[0], 8000);
    expect(msg).toMatchObject({
      topic: "resilient-topic",
      type: "pub",
      payload: "after-restart",
    });
  }, 15_000);

  it("re-subscribes dynamically subscribed topics after a reconnect", async () => {
    // The wallet's handshake-topic subscription goes through subscribe(),
    // not the constructor — it must survive a bridge drop just the same.
    const subscriber = makeTransport(["client-topic"]);
    const received: unknown[] = [];
    subscriber.on("message", msg => received.push(msg));
    subscriber.open();
    subscriber.subscribe("handshake-topic");

    await waitFor(() =>
      bridge.messages.some(m => m.type === "sub" && m.topic === "handshake-topic")
        ? true
        : undefined,
    );
    const clientSubsBefore = bridge.messages.filter(
      m => m.type === "sub" && m.topic === "client-topic",
    ).length;

    bridge.terminateAll();

    // reconnect completes once the constructor topic re-subscribes…
    await waitFor(
      () =>
        bridge.messages.filter(m => m.type === "sub" && m.topic === "client-topic").length >
        clientSubsBefore
          ? true
          : undefined,
      8000,
    );

    // …and the dynamic topic must come back with it
    await waitFor(
      () =>
        bridge.messages.filter(m => m.type === "sub" && m.topic === "handshake-topic").length > 1
          ? true
          : undefined,
      8000,
    );

    // end-to-end: a message published to the dynamic topic after the drop
    // (cached by the bridge until someone subscribes) is delivered
    const publisher = makeTransport([]);
    publisher.open();
    publisher.send("late-session-request", "handshake-topic", true);
    const msg = await waitFor(
      () =>
        received.find(m => (m as { topic?: string; type?: string }).topic === "handshake-topic"),
      8000,
    );
    expect(msg).toMatchObject({
      topic: "handshake-topic",
      type: "pub",
      payload: "late-session-request",
    });
  }, 20_000);

  it("sends exactly one sub frame per topic on first connect", async () => {
    // subscribe() during CONNECTING queues a sub frame, and the open handler
    // re-queues every tracked topic — without dedupe the handshake topic goes
    // out twice, and the bridge replays its pending history once per frame.
    const subscriber = makeTransport(["client-topic"]);
    subscriber.open();
    subscriber.subscribe("handshake-topic");

    await waitFor(() =>
      bridge.messages.some(m => m.type === "sub" && m.topic === "handshake-topic")
        ? true
        : undefined,
    );
    // let any duplicate frame land before counting
    await new Promise(resolve => setTimeout(resolve, 250));

    const subFrames = (topic: string) =>
      bridge.messages.filter(m => m.type === "sub" && m.topic === topic).length;
    expect(subFrames("handshake-topic")).toBe(1);
    expect(subFrames("client-topic")).toBe(1);
  });

  it("delivers a bridge-cached message exactly once to a topic subscribed during CONNECTING", async () => {
    // The wallet-facing symptom of duplicate sub frames: the dApp's cached
    // session_request replayed once per frame, so the wallet saw the same
    // payload id twice.
    const publisher = makeTransport([]);
    publisher.open();
    publisher.send("session-request", "handshake-topic", true);
    await waitFor(() => (bridge.messages.some(m => m.type === "pub") ? true : undefined));

    const subscriber = makeTransport(["client-topic"]);
    const received: unknown[] = [];
    subscriber.on("message", msg => received.push(msg));
    subscriber.open();
    subscriber.subscribe("handshake-topic");

    await waitFor(() => (received.length > 0 ? true : undefined));
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(received.length).toBe(1);
  });

  it("emits open on connect, close on socket death, and open again on reconnect", async () => {
    // The connector forwards these as transport_open / transport_close;
    // consumers (the wallet) rely on them to observe socket health.
    const transport = makeTransport(["some-topic"]);
    const events: string[] = [];
    transport.on("open", () => events.push("open"));
    transport.on("close", () => events.push("close"));
    transport.open();

    await waitFor(() => (events.includes("open") ? true : undefined));

    bridge.terminateAll();
    await waitFor(() => (events.includes("close") ? true : undefined), 8000);

    // the 1s auto-reconnect produces a second open
    await waitFor(() => (events.filter(e => e === "open").length > 1 ? true : undefined), 8000);
    expect(events.slice(0, 3)).toEqual(["open", "close", "open"]);
  }, 20_000);

  it("emits close on a user-initiated close", async () => {
    const transport = makeTransport([]);
    const events: string[] = [];
    transport.on("close", () => events.push("close"));
    transport.open();

    await waitFor(() => (transport.connected ? true : undefined));
    transport.close();

    expect(events).toEqual(["close"]);
  });
});
