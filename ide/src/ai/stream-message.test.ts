import { describe, expect, it } from "vitest";
import { streamingMessage } from "./stream-message";

describe("streamingMessage", () => {
  it("returns null before any object or message key exists", () => {
    expect(streamingMessage("")).toBeNull();
    expect(streamingMessage("Here is the answer")).toBeNull();
    expect(streamingMessage("{")).toBeNull();
    expect(streamingMessage('{"mess')).toBeNull();
    expect(streamingMessage('{"notes":[]}')).toBeNull();
    expect(streamingMessage("{}")).toBeNull();
  });

  it("returns null while the key or its separator is incomplete", () => {
    expect(streamingMessage('{"message"')).toBeNull();
    expect(streamingMessage('{"message":')).toBeNull();
    expect(streamingMessage('{"message": ')).toBeNull();
    expect(streamingMessage('{"message":\n')).toBeNull();
  });

  it("returns the decoded prefix of a value that is still streaming", () => {
    expect(streamingMessage('{"message":"Hel')).toBe("Hel");
    expect(streamingMessage('{"message":""')).toBe("");
    expect(streamingMessage('{"message":"')).toBe("");
    expect(streamingMessage('{"message":"a b c')).toBe("a b c");
  });

  it("returns the value once the closing quote arrived and ignores the rest", () => {
    expect(streamingMessage('{"message":"Hi"}')).toBe("Hi");
    expect(streamingMessage('{"message":"Hi","patches":[]}')).toBe("Hi");
    expect(streamingMessage('{ "message" : "spaced" }')).toBe("spaced");
  });

  it("finds the key after other fields", () => {
    expect(streamingMessage('{"notes":["ok"],"message":"later"')).toBe("later");
    expect(streamingMessage('{"kind":"message","other":1}')).toBeNull();
    expect(streamingMessage('{"kind":"message","message":"real"}')).toBe("real");
  });

  it("decodes every JSON escape, including unicode", () => {
    expect(streamingMessage('{"message":"a\\nb\\tc\\"d\\\\e\\/f\\bg\\fh"}')).toBe(
      'a\nb\tc"d\\e/f\bg\fh',
    );
    expect(streamingMessage('{"message":"caf\\u00e9 \\u0041"}')).toBe("café A");
    expect(streamingMessage('{"message":"\\ud83d\\ude00"}')).toBe("😀");
    expect(streamingMessage('{"mess\\u0061ge":"Hi"}')).toBe("Hi");
  });

  it("ends the visible prefix at an incomplete escape", () => {
    expect(streamingMessage('{"message":"a\\')).toBe("a");
    expect(streamingMessage('{"message":"a\\u00')).toBe("a");
    expect(streamingMessage('{"message":"a\\u12')).toBe("a");
    expect(streamingMessage('{"message":"ok\\q')).toBe("ok");
  });

  it("never matches a message key inside patch content", () => {
    const patch =
      '{"path":"src/a.ts","action":"create","content":"const message = 1;\\nconst o = {\\"message\\": \\"fake\\"};"}';
    const raw = '{"patches":[' + patch + "]";
    expect(streamingMessage(raw)).toBeNull();
    expect(streamingMessage(raw + ',"message":"after"')).toBe("after");
  });

  it("ignores a nested message key and braces inside the value", () => {
    expect(streamingMessage('{"patch":{"message":"nested"}}')).toBeNull();
    expect(streamingMessage('{"message":"keep { } [ ]"}')).toBe("keep { } [ ]");
  });

  it("tolerates prose before the object", () => {
    expect(streamingMessage('Sure! Here it is:\n{"message":"Hi"')).toBe("Hi");
  });

  it("returns null for a non-string message value", () => {
    expect(streamingMessage('{"message":null')).toBeNull();
    expect(streamingMessage('{"message":42')).toBeNull();
    expect(streamingMessage('{"message":true')).toBeNull();
    expect(streamingMessage('{"message":["x"]')).toBeNull();
    expect(streamingMessage('{"message":{"text":"x"}}')).toBeNull();
  });

  it("caps the visible value at 20000 characters", () => {
    const value = "x".repeat(25_000);
    expect(streamingMessage('{"message":"' + value)).toHaveLength(20_000);
    expect(streamingMessage('{"message":"' + value + '"}')).toHaveLength(20_000);
  });
});
