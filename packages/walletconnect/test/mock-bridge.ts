import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

interface BridgeMessage {
  topic: string;
  type: "pub" | "sub" | "ack";
  payload: string;
  silent: boolean;
}

export class MockBridge {
  private wss: WebSocketServer;
  private subs = new Map<string, Set<WebSocket>>();
  private cache = new Map<string, BridgeMessage[]>();
  public messages: BridgeMessage[] = [];
  private readonly gate: { refuse: boolean };

  private constructor(wss: WebSocketServer, gate: { refuse: boolean }) {
    this.wss = wss;
    this.gate = gate;
    wss.on("connection", socket => {
      socket.on("message", raw => {
        let message: BridgeMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.messages.push(message);
        if (message.type === "sub") {
          let topicSubs = this.subs.get(message.topic);
          if (!topicSubs) {
            topicSubs = new Set();
            this.subs.set(message.topic, topicSubs);
          }
          topicSubs.add(socket);
          // Mirrors pera-wc-bridge: EVERY sub frame replays the topic's
          // pending history, and the history survives until an ack (or TTL)
          // — so a duplicate sub frame means duplicate delivery.
          const pending = this.cache.get(message.topic) ?? [];
          for (const cached of pending) {
            socket.send(JSON.stringify(cached));
          }
        } else if (message.type === "ack") {
          // pera-wc-bridge clears the pending history on ack.
          this.cache.delete(message.topic);
        } else if (message.type === "pub") {
          const topicSubs = [...(this.subs.get(message.topic) ?? [])].filter(
            s => s.readyState === WebSocket.OPEN && s !== socket,
          );
          if (topicSubs.length) {
            for (const sub of topicSubs) {
              sub.send(JSON.stringify(message));
            }
          } else {
            const pending = this.cache.get(message.topic) ?? [];
            pending.push(message);
            this.cache.set(message.topic, pending);
          }
        }
      });
      socket.on("close", () => {
        for (const topicSubs of this.subs.values()) {
          topicSubs.delete(socket);
        }
      });
    });
  }

  static async start(): Promise<MockBridge> {
    const gate = { refuse: false };
    const wss = new WebSocketServer({
      port: 0,
      verifyClient: (_info, done) => done(!gate.refuse, 503),
    });
    await new Promise<void>(resolve => wss.on("listening", resolve));
    return new MockBridge(wss, gate);
  }

  get url(): string {
    const { port } = this.wss.address() as AddressInfo;
    return `http://localhost:${port}`;
  }

  /** Forcibly drop every client connection (simulates a bridge restart). */
  terminateAll(): void {
    for (const client of this.wss.clients) {
      client.terminate();
    }
  }

  /**
   * Drop every client and refuse new ones while keeping the port. Unlike
   * close(), the port can't be handed to another test file's bridge running
   * in parallel, so a connect attempt here always fails.
   */
  refuseConnections(): void {
    this.gate.refuse = true;
    this.terminateAll();
  }

  /** Send an arbitrary pub frame to the current subscribers of a topic. */
  injectFrame(topic: string, payload: string): void {
    const frame = JSON.stringify({ topic, type: "pub", payload, silent: true });
    for (const sub of this.subs.get(topic) ?? []) {
      if (sub.readyState === WebSocket.OPEN) {
        sub.send(frame);
      }
    }
  }

  async close(): Promise<void> {
    this.terminateAll();
    await new Promise<void>((resolve, reject) =>
      this.wss.close(err => (err ? reject(err) : resolve())),
    );
  }
}
