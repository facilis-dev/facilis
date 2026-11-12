import { describe, expect, it } from "vitest";
import { KernelPorts } from "./kernel-ports";

describe("KernelPorts", () => {
  it("lists live listeners by port", () => {
    const ports = new KernelPorts();
    ports.add(3001, 15);
    ports.add(3000, 5);
    expect(ports.list()).toEqual([
      { port: 3000, pid: 5 },
      { port: 3001, pid: 15 },
    ]);
  });

  it("forgets one port only", () => {
    const ports = new KernelPorts();
    ports.add(3000, 5);
    ports.add(3001, 15);
    expect(ports.forget(3000)).toBe(true);
    expect(ports.forget(3000)).toBe(false);
    expect(ports.list()).toEqual([{ port: 3001, pid: 15 }]);
  });

  it("drops every port a process owned when it exits", () => {
    const ports = new KernelPorts();
    ports.add(3000, 5);
    ports.add(3001, 15);
    ports.add(3002, 5);
    expect(ports.forgetProcess(5)).toBe(true);
    expect(ports.list()).toEqual([{ port: 3001, pid: 15 }]);
    expect(ports.forgetProcess(5)).toBe(false);
  });
});
