"use client";

import { useEffect, useState } from "react";

/**
 * Assume mobile até o primeiro paint no cliente — evita semana em 7 colunas
 * (minWidth ~756px) no SSR/hidratação, que provoca overflow horizontal em 375px.
 */
export function useIsMobile(breakpointPx = 767) {
  const [mobile, setMobile] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpointPx]);

  return mobile;
}
