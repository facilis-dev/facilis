// Wire formatting for the provider messages (D-112): a turn is a plain string, or the
// protocol's multimodal parts when it carries images. Kept beside providers.ts so both stay
// under the 300-line limit and the two protocols' part shapes sit next to each other.

import type { AiChatTurn, AiProtocol } from "./types";

interface WireImage {
  mediaType: string;
  data: string;
}

/** Parse a `data:image/...;base64,...` URL; anything else is not an image we send. */
function imageOf(url: string): WireImage | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
  if (match === null) return null;
  return { mediaType: match[1] ?? "image/jpeg", data: match[2] ?? "" };
}

/**
 * One message's content: a string when there is no image, the protocol's multimodal parts
 * otherwise. Images travel only for a vision preset, so a text-only model never sees a content
 * array it cannot parse.
 */
function wireContent(
  protocol: AiProtocol,
  turn: AiChatTurn,
  vision: boolean,
): string | unknown[] {
  const images = vision ? (turn.images ?? []) : [];
  const parts: unknown[] = [{ type: "text", text: turn.content }];
  for (const image of images) {
    if (protocol === "anthropic") {
      const parsed = imageOf(image);
      if (parsed === null) continue;
      parts.push({
        type: "image",
        source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
      });
      continue;
    }
    parts.push({ type: "image_url", image_url: { url: image } });
  }
  return parts.length === 1 ? turn.content : parts;
}

export function toWireMessages(
  messages: readonly AiChatTurn[],
  protocol: AiProtocol,
  vision: boolean,
): Array<{ role: "user" | "assistant"; content: string | unknown[] }> {
  return messages.map((turn) => ({
    role: turn.role,
    content: wireContent(protocol, turn, vision),
  }));
}
