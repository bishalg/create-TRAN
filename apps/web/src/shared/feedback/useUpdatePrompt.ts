import { useEffect, useRef } from 'react';
import { type StandingSignal, updatePrompt } from '@tran/core';
import { readDismissedVersion, rememberDismissed } from '../lib/updatePrompt.js';
import type { Feedback } from './FeedbackProvider.js';

/**
 * Offers the update when the API recommends one (`X-Tran-Update: recommended`, REQ-VER-006): the
 * catalogue's `update_recommended` dialog, at most once per recommended version (REQ-VER-010). The
 * Rust decision `updatePrompt` says whether to ask; "Update" reloads into the newest build, "Not
 * now" is remembered for that version only.
 */
export function useUpdatePrompt(
  signal: StandingSignal | null,
  feedback: Feedback,
  reload: () => void
): void {
  /** The recommended version already asked about on this page, so one answer is enough. */
  const asked = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (signal?.standing !== 'update_recommended') return;
    const recommended = signal.recommendedVersion;
    const show = updatePrompt({
      standing: signal.standing,
      recommendedVersion: recommended,
      dismissedVersion: readDismissedVersion(),
    });
    if (!show || asked.current === recommended) return;
    asked.current = recommended;
    void feedback.confirm('update_recommended').then((update) => {
      if (update) reload();
      else rememberDismissed(recommended ?? '');
    });
  }, [signal, feedback, reload]);
}
