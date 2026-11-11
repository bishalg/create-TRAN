# Rate limiting playbook

What it is: limiting how often one caller may use the API, and refusing work early when the server is overwhelmed.
Why it is here: an API with no limits lets anyone hammer sign-in, and fails all at once under load. Rules:
[spec 031](./specs/031-rate-limiting.md). Reasons: [ADR-0050](./adr/0050-rate-limits-are-policy-data.md).

## The rules

1. **Every route has a class** (`auth`, `write`, `read`, `exempt`) in the route table. Limits belong to classes.
2. **Count by user when signed in, else by address,** and trust `X-Forwarded-For` only from `TRUSTED_PROXIES`.
   The address is resolved once per request (`middleware/client_addr.rs`); handlers read that, never a header.
3. **Limit auth routes before authenticating,** and refresh also per presented refresh token.
4. **Decide before touching the store:** the user of a bearer token comes from an in-memory map of the access
   tokens this process issued or authenticated; an unknown token is counted by address.
5. **Answer `429` with `Retry-After`,** the same whether or not the account exists.
6. **Bound the limiter itself:** a maximum number of keys, least recently used evicted, idle buckets dropped.
7. **Shed load** with `503` and `Retry-After` past the in-flight ceiling. Do not queue.
8. **Fail open if the limiter breaks,** except on auth routes; log it once a minute, not per request.
9. **Clients wait as told** and never auto-retry something a person started.
10. **Never log who was limited,** only the class and the count (`tran_rate_limited_total{class}`).

## The numbers

| Class    | Sustained      | Burst | Counted by                      |
| :------- | :------------- | :---- | :------------------------------ |
| `auth`   | 10 per minute  | 5     | address, and token on refresh   |
| `write`  | 60 per minute  | 20    | user, else address              |
| `read`   | 300 per minute | 60    | user, else address (and config) |
| `exempt` | no limit       |       | health and readiness probes     |

Change them with `RATE_LIMIT_<CLASS>=<per minute>[/<burst>]`; both must be positive, and a malformed value stops the
server and `api check-config`, naming the variable. They live in `crates/rust-core/src/rate.rs`.

## Reading `X-Forwarded-For`

Only when the socket peer is in `TRUSTED_PROXIES`. Every header line is read, in order, as one list, and walked from
the right past trusted proxies; the first other hop is the client. A hop may be an address, `ip:port`, `[ipv6]` or
`[ipv6]:port` (some load balancers append the port). If a hop on that walk does not parse, the whole header is
ignored and the peer is used, so a caller cannot slip a value of its own past a broken entry. `X-Real-IP` is never
read. A request with no socket peer (the router driven in-process by a test) counts as `127.0.0.1` and is never a
trusted proxy.

## Where it lives

| Part                | Place                                                |
| :------------------ | :--------------------------------------------------- |
| Policy and `take`   | `crates/rust-core/src/rate.rs`, `fixtures/rate.json` |
| Layer, key          | `apps/api/src/middleware/rate_limit.rs`              |
| Client address      | `apps/api/src/middleware/client_addr.rs`, `geo.rs`   |
| `RateLimitStore`    | `apps/api/src/rate_limit_store.rs`                   |
| Refresh-token limit | `apps/api/src/routes/auth.rs` (`refresh`)            |
| Route classes       | the route table in `apps/api/src/routes/table.rs`    |
| Client message      | the feedback catalogue (`server.rate_limited`)       |

## What a fork adds

- **`TRUSTED_PROXIES`** set to its load balancer's addresses. Check it by reading the logged client address once.
- **A shared `RateLimitStore`** (Redis or the database) when it runs more than one API process; the token-to-user
  map is per process too, so a token issued elsewhere is counted by address until this process authenticates it.
- **Limits on the credential check itself,** per account as well as per address, with lockout or step-up.
- **Edge protection:** a CDN or WAF for volumetric attacks and bots. The API's limiter is the last line, not the first.
