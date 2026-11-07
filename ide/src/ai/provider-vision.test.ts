// Image serialization (D-112): only a vision preset turns a turn's images into content parts,
// and each protocol has its own shape.
import { describe, expect, it } from "vitest";
import { PRESETS, buildRequest } from "./providers";
import type { AiSettings } from "./types";

function preset(id: string) {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error("missing preset " + id);
  return found;
}

const IMAGE = "data:image/jpeg;base64,QUJD";
const TURNS = [{ role: "user", content: "look", images: [IMAGE] }] as const;

describe("vision message parts", () => {
  it("sends an OpenAI image_url part for the openai preset", () => {
    const settings: AiSettings = {
      providerId: "openai",
      apiKey: "sk-test",
      model: "gpt-5",
      baseUrl: "",
    };
    expect(buildRequest(preset("openai"), settings, "", TURNS).body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: IMAGE } },
          ],
        },
      ],
    });
  });

  it("sends an Anthropic base64 image source", () => {
    const settings: AiSettings = {
      providerId: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-5",
      baseUrl: "",
    };
    expect(buildRequest(preset("anthropic"), settings, "", TURNS).body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
            },
          ],
        },
      ],
    });
  });

  it("drops images for a text-only preset", () => {
    const settings: AiSettings = {
      providerId: "deepseek",
      apiKey: "sk-test",
      model: "deepseek-chat",
      baseUrl: "",
    };
    expect(buildRequest(preset("deepseek"), settings, "", TURNS).body).toMatchObject({
      messages: [{ role: "user", content: "look" }],
    });
  });
});
