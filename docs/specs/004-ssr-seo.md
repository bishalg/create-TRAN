# 004 Server rendering and SEO

Scope: how `apps/web` is rendered and described to crawlers and social networks. Rationale:
[ADR-0010](../adr/0010-tanstack-start-ssr.md), [ADR-0011](../adr/0011-seo-metadata-pure-functions.md),
[ADR-0012](../adr/0012-browser-calls-api-directly.md).

## Rendering and routes

### REQ-SEO-001 [planned] Server-rendered HTML

Every route MUST return complete HTML (content and metadata) in the first response, without running JavaScript.
**Verified by:** BDD fetching the page with scripting disabled.

### REQ-SEO-002 [planned] Routes

| Path                                | Purpose                     | Indexed |
| :---------------------------------- | :-------------------------- | :------ |
| `/`                                 | Eligibility checker         | yes     |
| `/voting-age`                       | List of supported countries | yes     |
| `/voting-age/{code}`                | Voting age for one country  | yes     |
| `/sitemap.xml`, `/robots.txt`       | Crawler files               | n/a     |
| `/og/{code}.png`, `/og/default.png` | Social card images          | n/a     |

**Verified by:** BDD route scenarios.

### REQ-SEO-003 [planned] Data comes from the API, on the server

The voting-age pages MUST load their data on the server from `GET /api/vote/countries[/{code}]` (REQ-API-009/010)
through a server function. The API base URL for the server is server-side configuration.
**Verified by:** loader unit tests, BDD (page content equals API content).

### REQ-SEO-004 [planned] Real not-found

An unsupported or malformed country code MUST return HTTP `404`, render a not-found page, and carry
`<meta name="robots" content="noindex">`. It MUST NOT be listed in the sitemap.
**Verified by:** BDD "unknown country returns 404".

## Metadata

### REQ-SEO-005 [planned] Core tags on every page

Each page MUST have a unique `<title>` of at most 60 characters, a `<meta name="description">` of 50–160 characters,
a viewport tag, an absolute `<link rel="canonical">`, `<html lang>`, and `theme-color` for both colour schemes.
**Verified by:** `seo.test.ts`, BDD.

### REQ-SEO-006 [planned] Open Graph

Each indexable page MUST set `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url` (equal to the canonical),
`og:locale`, `og:image` (absolute URL), `og:image:width`, `og:image:height` and `og:image:alt`.
**Verified by:** `seo.test.ts`, BDD.

### REQ-SEO-007 [planned] Twitter / X card

Each indexable page MUST set `twitter:card` = `summary_large_image` plus title, description and image.
**Verified by:** `seo.test.ts`, BDD.

### REQ-SEO-008 [planned] Structured data

`/` MUST include `WebSite` JSON-LD; `/voting-age/{code}` MUST include `FAQPage` and `BreadcrumbList` JSON-LD whose answer
equals the visible answer. JSON-LD MUST be valid JSON with no `</script>` injection.
**Verified by:** `seo.test.ts`, BDD.

### REQ-SEO-009 [planned] Social card images

`/og/{code}.png` MUST return a 1200×630 PNG showing the country name and its voting age with long-lived cache headers;
an unsupported code MUST return `404`. `/og/default.png` MUST exist.
**Verified by:** `ogImage.test.ts`, BDD (PNG signature and dimensions).

### REQ-SEO-010 [planned] Sitemap and robots

`/sitemap.xml` MUST list `/`, `/voting-age` and every supported country page with absolute URLs. `/robots.txt` MUST allow
crawling, disallow `/api/`, and reference the sitemap.
**Verified by:** BDD.

### REQ-SEO-011 [planned] One site URL

Absolute URLs MUST be built from the `SITE_URL` setting, never from the incoming request, so canonicals are stable
behind proxies.
**Verified by:** `seo.test.ts`.

### REQ-SEO-012 [planned] Metadata follows the data

Page titles, descriptions and cards MUST be derived from loader data by pure functions with no I/O.
**Verified by:** `seo.test.ts`.
