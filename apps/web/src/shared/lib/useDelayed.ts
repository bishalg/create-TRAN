import { useEffect, useState } from 'react';

/**
 * True only once `active` has stayed true for `delayMs`, false again the moment it turns false.
 * A fast activity never shows its indicator (REQ-LOAD-002, ADR-0035: a delay, no minimum time).
 */
export function useDelayed(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  // `active &&` makes the reset immediate instead of one effect later.
  return active && elapsed;
}
