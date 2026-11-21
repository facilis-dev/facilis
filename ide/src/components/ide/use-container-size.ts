// Live content-box size of a container (issue #59): the graph tab decides between the details
// satellite and the bottom sheet from its width, and clamps the sheet height to its height.

import { useEffect, useState, type RefObject } from "react";

export interface ContainerSize {
  readonly width: number;
  readonly height: number;
}

export function useContainerSize(ref: RefObject<HTMLDivElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
