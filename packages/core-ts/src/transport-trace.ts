/**
 * The trace a request was sent with, kept beside a transport failure (REQ-OBS-011): a call that got
 * no response has no `traceparent` answer to read, so `timedFetch` records the one it sent and
 * `classifyError` reads it back.
 */
const sent = new WeakMap<object, string>();

/** Records the `traceparent` of `headers` against `error`, and returns `error`. */
export function rememberTrace<E extends object>(error: E, headers: HeadersInit | undefined): E {
  const traceparent = new Headers(headers).get('traceparent');
  // `00-<trace id>-<span id>-<flags>`; only a well-formed header is ever sent (trace.ts).
  const traceId = traceparent?.split('-')[1];
  if (traceId) sent.set(error, traceId);
  return error;
}

/** The trace id `error`'s request was sent with, if `timedFetch` saw one. */
export function sentTraceId(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? sent.get(error) : undefined;
}
