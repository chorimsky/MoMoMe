import { useEffect, useState } from "react";

/** True when the viewport is at/under `maxWidth` (default 600px). Used to shrink
 *  header chrome (the wide brand wordmark especially) so toolbars fit phones. */
export function useNarrow(maxWidth = 600): boolean {
  const q = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return narrow;
}
