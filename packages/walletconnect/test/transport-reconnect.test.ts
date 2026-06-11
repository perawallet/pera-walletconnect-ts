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
});
