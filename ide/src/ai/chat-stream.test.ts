import { describe, expect, it } from "vitest";
import { StreamAccumulator } from "./chat-stream";

describe("StreamAccumulator", () => {
  it("reports the growing message prefix", () => {
    let clock = 0;
    const stream = new StreamAccumulator(() => (clock += 100));
    expect(stream.push('{"message":"Hel')).toBe("Hel");
    expect(stream.push("lo")).toBe("Hello");
    expect(stream.push('","patches":[]}')).toBeNull();
  });

  it("coalesces paints inside the emit window", () => {
    let clock = 100;
    const stream = new StreamAccumulator(() => clock);
    expect(stream.push('{"message":"a')).toBe("a");
    clock += 5;
    expect(stream.push("b")).toBeNull();
    clock += 40;
    expect(stream.push("c")).toBe("abc");
  });

  it("paints nothing before the message key arrives", () => {
    const stream = new StreamAccumulator(() => 1);
    expect(stream.push('{"patches":[]')).toBeNull();
    expect(stream.push(',"message":"x')).toBe("x");
  });

  it("starts clean after reset", () => {
    const stream = new StreamAccumulator(() => 1);
    stream.push('{"message":"old');
    stream.reset();
    expect(stream.push('{"message":"new')).toBe("new");
  });
});
