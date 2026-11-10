# Rate limiting playbook

What it is: limiting how often one caller may use the API, and refusing work early when the server is overwhelmed.
Why it is here: an API with no limits lets anyone hammer sign-in, and fails all at once under load. Rules:
[spec 031](./specs/031-rate-limiting.md). Reasons: [ADR-0050](./adr/0050-rate-limits-are-policy-data.md).

## The rules

1. **Every route has a class** (`auth`, `write`, `read`, `exempt`) in the route table. Limits belong to classes.
2. **Count by user when signed in, else by address,** and trust `X-Forwarded-For` only from `TRUSTED_PROXIES`.
3. **Limit auth routes before authenticating,** and refresh also per session.
4. **Answer `429` with `Retry-After`,** the same whether or not the account exists.
5. **Bound the limiter itself:** a maximum number of keys, with eviction.
6. **Shed load** with `503` and `Retry-After` past the in-flight ceiling. Do not queue.
7. **Fail open if the limiter breaks,** except on auth routes.
8. **Clients wait as told** and never auto-retry something a person started.
9. **Never log who was limited,** only the class and the count.

## The numbers

| Class    | Sustained      | Burst | Counted by                      |
| :------- | :------------- | :---- | :------------------------------ |
| `auth`   | 10 per minute  | 5     | address, and session on refresh |
| `write`  | 60 per minute  | 20    | user, else address              |
| `read`   | 300 per minute | 60    | user, else address              |
| `exempt` | no limit       |       | health, configuration           |

Change them with `RATE_LIMIT_<CLASS>`; they live in `crates/rust-core/src/rate.rs`.

## Where it lives

| Part                         | Place                                                |
| :--------------------------- | :--------------------------------------------------- |
| Policy and `take`            | `crates/rust-core/src/rate.rs`, `fixtures/rate.json` |
| Layer, key, `RateLimitStore` | `apps/api/src/middleware/`                           |
| Route classes                | the route table in `apps/api/src/routes/mod.rs`      |
| Client message               | the feedback catalogue (`rate.limited`)              |

## What a fork adds

- **`TRUSTED_PROXIES`** set to its load balancer's addresses. Check it by reading the logged client address once.
- **A shared `RateLimitStore`** (Redis or the database) when it runs more than one API process.
- **Limits on the credential check itself,** per account as well as per address, with lockout or step-up.
- **Edge protection:** a CDN or WAF for volumetric attacks and bots. The API's limiter is the last line, not the first.
