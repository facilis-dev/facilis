import { describe, expect, it } from "vitest";
import type { AiChatTurn } from "./types";
import { replayTurns } from "./chat-session-types";
import { answer, sessionWith } from "./chat-session-fixtures";

const IMAGE = "data:image/png;base64,QUJD";
const OTHER = "data:image/png;base64,REVG";

describe("pasted images in the chat (D-113)", () => {
  it("sends an image-only message and shows it on the bubble", async () => {
    const seen: AiChatTurn[][] = [];
    const chat = sessionWith(async (input) => {
      seen.push([...input.messages]);
      return { ok: true, text: answer() };
    });

    await chat.send("", [IMAGE]);

    expect(chat.getSnapshot().messages[0]).toMatchObject({
      role: "user",
      content: "",
      images: [IMAGE],
    });
    expect(seen[0]?.[0]).toEqual({ role: "user", content: "", images: [IMAGE] });
  });

  it("ignores a message with neither text nor images", async () => {
    let calls = 0;
    const chat = sessionWith(async () => {
      calls += 1;
      return { ok: true, text: answer() };
    });

    await chat.send("   ");

    expect(calls).toBe(0);
    expect(chat.getSnapshot().messages).toEqual([]);
  });

  it("replays the pasted image with the next message", async () => {
    const seen: AiChatTurn[][] = [];
    const chat = sessionWith(async (input) => {
      seen.push([...input.messages]);
      return { ok: true, text: answer() };
    });

    await chat.send("look", [IMAGE]);
    await chat.send("and now?");

    expect(seen[1]).toContainEqual({ role: "user", content: "look", images: [IMAGE] });
  });

  it("replay keeps image-only messages and merges images when roles fold", () => {
    const turns = replayTurns(
      [
        { id: "u1", role: "user", content: "", images: [IMAGE], at: 1 },
        { id: "u2", role: "user", content: "retry", images: [OTHER], at: 2 },
      ],
      20,
    );
    expect(turns).toEqual([{ role: "user", content: "retry", images: [IMAGE, OTHER] }]);
  });
});
