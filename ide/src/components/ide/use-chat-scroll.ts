// Transcript auto-follow for the chat panel (D-187).
//
// Extracted from ChatPanel (which sits at the 300-line limit): the state is small, but the
// rules — follow only near the end, an explicit lock, reset per conversation — are worth one
// named place. The position test is the pure helper in chat-scroll.ts.

import { useEffect, useRef, useState, type RefObject } from "react";
import { isAtBottom } from "./chat-scroll";

export interface ChatScroll {
  /** Attach to the scrolling transcript container. */
  listRef: RefObject<HTMLDivElement | null>;
  /** New content should stay in view (not locked, and the reader is at the end). */
  follow: boolean;
  /** The explicit pin: follow is frozen even at the end. */
  locked: boolean;
  onScroll: () => void;
  /** Jump to the newest activity and resume following. */
  resume: () => void;
  /** The header pin: lock while following, resume while paused. */
  toggle: () => void;
}

export function useChatScroll(conversationId: string): ChatScroll {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [locked, setLocked] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const follow = !locked && atBottom;

  const scrollToLatest = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    setAtBottom(true);
  };

  const resume = () => {
    setLocked(false);
    setAtBottom(true);
    scrollToLatest();
  };

  // A new conversation starts following, whatever the previous one was locked to.
  useEffect(() => {
    setLocked(false);
    setAtBottom(true);
  }, [conversationId]);

  return {
    listRef,
    follow,
    locked,
    onScroll: () => {
      const list = listRef.current;
      if (list) setAtBottom(isAtBottom(list));
    },
    resume,
    toggle: () => {
      if (follow) setLocked(true);
      else resume();
    },
  };
}
