import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarStack } from "./avatar.tsx";

describe("Avatar", () => {
  it("renders initials with an accessible name and deterministic tone", () => {
    const html = renderToStaticMarkup(<Avatar name="Ada Lovelace" size="sm" />);

    expect(html).toContain("AL");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Ada Lovelace"');
    expect(html).toContain('title="Ada Lovelace"');
    expect(html).toContain("fc-avatar--sm");

    const tone = /data-tone="(\d)"/.exec(html)?.[1];
    const again = renderToStaticMarkup(<Avatar name="Ada Lovelace" />);
    expect(/data-tone="(\d)"/.exec(again)?.[1]).toBe(tone);
  });

  it("stacks avatars and summarises the rest", () => {
    const html = renderToStaticMarkup(
      <AvatarStack
        names={["Ada Lovelace", "Grace Hopper", "Alan Turing", "Edsger Dijkstra"]}
        max={2}
      />,
    );

    expect(html).toContain("fc-avatar-stack");
    expect(html).toContain("+2");
    expect(html).toContain('aria-label="Ada Lovelace"');
    expect(html).toContain('aria-label="Grace Hopper"');
    expect(html).not.toContain('aria-label="Alan Turing"');
  });
});
