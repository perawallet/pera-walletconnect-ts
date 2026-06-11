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

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
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
          const pending = this.cache.get(message.topic) ?? [];
          this.cache.delete(message.topic);
          for (const cached of pending) {
            socket.send(JSON.stringify(cached));
          }
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
        // "ack" intentionally ignored
      });
      socket.on("close", () => {
        for (const topicSubs of this.subs.values()) {
          topicSubs.delete(socket);
        }
      });
    });
  }

  static async start(): Promise<MockBridge> {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => wss.on("listening", resolve));
    return new MockBridge(wss);
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
