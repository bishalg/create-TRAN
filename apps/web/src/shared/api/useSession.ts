import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifyError,
  createSessionClient,
  logFailure,
  type AuthSession,
  type SessionClient,
  type SessionUser,
  type UserRole,
} from '@tran/core';
import type { Feedback } from '../feedback/FeedbackProvider.js';
import { resolveApiBaseUrl } from './apiUrl.js';

export interface UseSessionOptions {
  feedback: Feedback;
  /** A known session skips the boot refresh (tests and previews start on a given screen). */
  initialSession?: AuthSession;
  /** Inject a client in tests. */
  client?: SessionClient;
}

const SIGNED_OUT: AuthSession = { status: 'unauthenticated' };

const fromUser = (user: SessionUser): AuthSession => ({
  status: 'authenticated',
  userId: user.user_id,
  role: user.role,
});

/** The demo's stable user per role; the API answers with the same ids. */
const deviceUser = (role: UserRole) => (role === 'citizen_voter' ? 'voter-001' : 'auditor-001');

/** A call the user did not start: log it at its catalogue level, never show it. */
const log = (failure: unknown) => logFailure(classifyError(failure));

/**
 * The session the shell routes on (spec 006, spec 022). `null` while the boot refresh is in
 * flight, which is the Splash.
 *
 * - Boot: `POST /api/auth/refresh` with the `HttpOnly` cookie restores the session and its
 *   destination; anything else leads to Auth Welcome (REQ-SEC-021). A restored session is then
 *   validated with `GET /api/auth/session`, so a `401` takes the refresh-and-repeat path.
 * - Sign-in: the device session starts at once and works offline; the API session is established
 *   behind it, and its failure only reaches the log (ADR-0039, decision 7).
 * - Sign-out: the device forgets the session first, then tells the server (REQ-SEC-022).
 * - Deletion: the opposite order. The server decides, and only its success signs the device out
 *   and acknowledges it (REQ-ACC-006); a failure leaves the session exactly as it was.
 * - A session the recovery table signed out opens the `auth.session_expired` dialog (REQ-ERR-010).
 */
export function useSession({ feedback, initialSession, client: injected }: UseSessionOptions) {
  const [client] = useState(
    () => injected ?? createSessionClient({ baseUrl: resolveApiBaseUrl(import.meta.env) })
  );
  const [session, setSession] = useState<AuthSession | null>(initialSession ?? null);
  /** Bumped by every sign-in and sign-out, so a late answer about an older session is ignored. */
  const epoch = useRef(0);
  const booted = useRef(initialSession !== undefined);

  const validate = useCallback(async () => {
    const started = epoch.current;
    try {
      await client.whoAmI();
    } catch (failure) {
      if (started !== epoch.current) return;
      // The recovery table signed the client out: the user decides what happens next.
      if (client.user === null) feedback.report(classifyError(failure));
      else log(failure);
    }
  }, [client, feedback]);

  // Once per page load. No cancellation: React's development double effect must still route.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void client.refresh().then((outcome) => {
      if (outcome.kind === 'refreshed') {
        setSession(fromUser(outcome.user));
        void validate();
        return;
      }
      // No session is the normal first visit; only a failed refresh is worth a log line.
      if (outcome.kind === 'kept') log(outcome.error);
      setSession(SIGNED_OUT);
    });
  }, [client, validate]);

  const signIn = useCallback(
    (role: UserRole) => {
      epoch.current += 1;
      setSession({ status: 'authenticated', userId: deviceUser(role), role });
      client.signIn(role).catch(log);
    },
    [client]
  );

  const signOut = useCallback(() => {
    epoch.current += 1;
    setSession(SIGNED_OUT);
    void client.signOut().then((failure) => failure && log(failure));
  }, [client]);

  /** Resolves `null` once the server deleted the account and the device followed, else the
   * failure, untouched, for the screen to report. */
  const deleteAccount = useCallback(async (): Promise<unknown> => {
    try {
      await client.deleteAccount();
    } catch (failure) {
      return failure;
    }
    epoch.current += 1;
    setSession(SIGNED_OUT);
    feedback.acknowledge('account_deleted');
    return null;
  }, [client, feedback]);

  return { session, signIn, signOut, deleteAccount };
}
