/**
 * Probes the server while a connectivity banner is up, on the shared schedule and on demand
 * (REQ-ERR-013). Framework-free so every web screen — or another app — can reuse it.
 */
import { recoveryProbeDelayMs } from './resilience.js';

export interface RecoveryOptions {
  /** Resolves when the server answered; rejects while it is still unreachable. No retries. */
  probe: (signal: AbortSignal) => Promise<unknown>;
  /** Called once, after the first successful probe. */
  onRecovered: () => void;
}

export interface RecoveryLoop {
  /** Probe now (the network came back, or the app returned to the foreground). */
  nudge(): void;
  /** Stop probing; a probe in flight is aborted and its answer ignored. */
  stop(): void;
}

export function startRecovery({ probe, onRecovered }: RecoveryOptions): RecoveryLoop {
  let probes = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;

  const schedule = () => {
    timer = setTimeout(run, recoveryProbeDelayMs(probes + 1));
  };

  function run() {
    clearTimeout(timer);
    probes += 1;
    const controller = new AbortController();
    inFlight = controller;
    probe(controller.signal).then(
      () => {
        if (stopped || controller.signal.aborted) return;
        stopped = true;
        inFlight = undefined;
        onRecovered();
      },
      () => {
        if (stopped) return;
        inFlight = undefined;
        schedule();
      }
    );
  }

  schedule();
  return {
    nudge() {
      if (!stopped && !inFlight) run();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
    },
  };
}
