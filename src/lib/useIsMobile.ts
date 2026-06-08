"use client";

import { useState, useEffect } from "react";

// True when the viewport is at/under the breakpoint. Starts false so SSR and the
// first client render agree (no hydration mismatch); updates right after mount.
export function useIsMobile(breakpoint = 720): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}
