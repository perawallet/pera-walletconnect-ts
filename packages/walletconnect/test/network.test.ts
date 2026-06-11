/**
 * Tests for NetworkMonitor (src/transport/network.ts).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import NetworkMonitor from "../src/transport/network";

afterEach(() => vi.unstubAllGlobals());

describe("NetworkMonitor", () => {
  it("on() + trigger(): calls callback for matching event", () => {
    const monitor = new NetworkMonitor();
    const cb = vi.fn();
    monitor.on("online", cb);
    monitor.trigger("online");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("trigger('offline') calls offline callback only", () => {
    const monitor = new NetworkMonitor();
    const onlineCb = vi.fn();
    const offlineCb = vi.fn();
    monitor.on("online", onlineCb);
    monitor.on("offline", offlineCb);
    monitor.trigger("offline");
    expect(offlineCb).toHaveBeenCalledTimes(1);
    expect(onlineCb).not.toHaveBeenCalled();
  });

  it("trigger() with no registered listeners is a no-op", () => {
    const monitor = new NetworkMonitor();
    expect(() => monitor.trigger("online")).not.toThrow();
  });

  it("multiple callbacks for the same event are all invoked", () => {
    const monitor = new NetworkMonitor();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    monitor.on("online", cb1);
    monitor.on("online", cb2);
    monitor.trigger("online");
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("registers window event listeners when window is available", () => {
    const listeners: Record<string, (() => void)[]> = {};
    vi.stubGlobal("window", {
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(cb);
      },
    });

    const monitor = new NetworkMonitor();
    const cb = vi.fn();
    monitor.on("online", cb);

    // Simulate browser firing the 'online' event
    listeners["online"]?.forEach(fn => fn());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
