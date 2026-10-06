import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

/**
 * With frameloop="demand", nothing redraws after the canvas settles (final size, fonts,
 * first prediction) unless something asks. Render a handful of frames after mount or
 * resize, then stop. Without it, an on-demand canvas with no animation can stay blank.
 */
export function Warmup() {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  useEffect(() => {
    invalidate();
    const timers = [100, 400, 1000, 2000].map((ms) => window.setTimeout(() => invalidate(), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [invalidate, size.width, size.height]);
  return null;
}
