# Hosting

This repository has three MCP entry points. Stdio is still the default, the existing
`--http` / `MCP_TRANSPORT=http` option starts a long-lived Node HTTP listener, and
Vercel can build the stateless function in `api/mcp.ts`. Nothing has been deployed.

## Vercel serverless function

`vercel.json` rewrites the public `/mcp` path to the function at `/api/mcp`. Vercel's
current `/api/*.ts` convention uses the Node.js runtime by default and accepts the Web
Standard `Request` / `Response` handler exported by `api/mcp.ts`; no Edge runtime is
configured. Node is required because the tool implementation uses Node APIs and
`node-html-parser`.

The function uses the installed `@modelcontextprotocol/sdk` 1.27.1
`WebStandardStreamableHTTPServerTransport` directly. `createMcpFetchHandler()` creates
one `SlidingWindowRateLimiter` when a function instance starts, then creates a fresh
`McpServer` through `createMcpServer()` and a fresh stateless transport for every
request. This is the lifecycle SDK 1.27.1 requires: its stateless transport throws if
the same transport handles a second request.

The route accepts MCP `POST` requests and returns JSON responses. Stateless `GET` and
`DELETE` operations return `405`; there is no protocol session, standalone notification
stream, replay, or session deletion. This does not affect stdio or the long-running
HTTP listener.

### Why the native SDK transport was chosen

The old `@vercel/mcp-adapter` package has moved to `mcp-handler`. As verified on
2026-08-31, current `mcp-handler` 2.1.1 requires the MCP SDK v2 packages and Zod 4. This
repository uses SDK 1.27.1 and its existing variadic `server.tool(...)` registration
API, so adopting `mcp-handler` 2.x would require an unrelated SDK/tool-schema migration.
The compatible adapter line, `mcp-handler` 1.1.0, declares an exact SDK 1.26.0 peer in
its published package metadata. The already-installed SDK 1.27.1 provides the required
Web Standard transport itself, so using it avoids both a peer mismatch and an adapter
dependency while matching Vercel's current fetch-handler API.

Relevant primary references:

- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel `mcp-handler`](https://github.com/vercel/mcp-handler)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Long-running Node HTTP service

Use Node.js 20 or newer. The build is `npm ci` followed by `npm run build`. A
long-running host starts `node dist/index.js --http`, terminates TLS in front of the
process, and forwards traffic to the configured port. Because the local-safe default
bind address is `127.0.0.1`, a container normally sets `MCP_HOST=0.0.0.0`.

`src/http-server.ts` deliberately remains a separate long-running entry point. It opens
a listening socket and must not be invoked from `api/mcp.ts`.

## Runtime and files

The deployment-relevant source files are:

- `src/index.ts`: selects stdio or long-running HTTP and reads host/port configuration.
- `src/server.ts`: creates the `McpServer` and registers every tool once.
- `src/http-server.ts`: exposes the long-running `/mcp` Streamable HTTP endpoint.
- `src/serverless-handler.ts`: adapts a Web `Request` to one fresh stateless MCP server
  and transport, and applies origin and per-instance rate-limit checks.
- `api/mcp.ts`: Vercel Node function entry point.
- `vercel.json`: maps public `/mcp` requests to `/api/mcp`.
- `src/resilience/cache.ts`: `CacheStore` interface and in-memory default.
- `src/resilience/rate-limiter.ts`: atomic `RateLimitStore` interface and in-memory
  sliding-window default.
- `src/resilience/circuit-breaker.ts` and `upstream-fetch.ts`: cache-first upstream
  protection, with one breaker per upstream host.
- `src/api/*.ts`: all upstream access routes through `upstreamFetch`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | Set to `http` only for the long-running hosted process. It is not used by the Vercel function. |
| `MCP_HOST` | `HOST`, then `127.0.0.1` | Long-running bind address. Use `0.0.0.0` in a container. |
| `MCP_PORT` | `PORT`, then `3000` | Long-running listener port. |
| `MCP_ALLOWED_ORIGINS` | empty | Comma-separated browser origins. Requests without `Origin` are accepted; requests with an unlisted origin are rejected by both HTTP paths. |
| `MCP_RATE_LIMIT_MAX` | `60` | Requests allowed per caller in one window. On Vercel this is per warm function instance, not global. |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Sliding-window duration. |
| `UPSTREAM_CACHE_TTL_MS` | `0` (off) | Successful upstream-response cache lifetime. **Off by default** so stdio, the published npm package, keeps bare fetch semantics and never serves stale election results. Hosted deployments should set this (e.g. `600000`); on Vercel entries exist only in one warm instance. |
| `UPSTREAM_CIRCUIT_FAILURE_THRESHOLD` | `3` | Consecutive `403`, `408`, `429`, `5xx`, or network failures before one instance opens a target circuit. `403` counts because that is what a government WAF returns when it starts blocking you. |
| `UPSTREAM_CIRCUIT_RESET_MS` | `60000` | Delay before one half-open probe is allowed in that instance. |

| `UPSTREAM_TIMEOUT_MS` | `15000` | Per-request upstream timeout. Caps held sockets on the long-running listener and billable compute on serverless when an upstream hangs. |
| `MCP_TRUST_PROXY_HEADERS` | unset | Long-running listener only. When `1`, rate-limit identity trusts `X-Forwarded-For` / `CF-Connecting-IP`. **Leave unset unless a trusted proxy overwrites those headers** — otherwise a caller sends a fresh value per request and bypasses the limit entirely. |

There are no API-key or Redis environment variables. Do not invent them in provider
configuration until a shared-store implementation exists.

## Exact serverless resilience behavior

The serverless route intentionally uses the existing in-memory defaults. On a
warm Vercel function instance, it genuinely provides all of the following:

- repeated identical successful upstream `GET` and read-only `POST` requests can hit
  that instance's cache;
- concurrent identical requests reaching that instance are coalesced;
- the sliding-window limit is enforced for requests reaching that instance, keyed first
  by Vercel's `X-Vercel-Forwarded-For` client-IP header; and
- repeated failures to one upstream host open the circuit on that instance.

None of those controls coordinate across instances, regions, cold starts, deployments,
or instance recycling. Consequently:

- **there is no global 60-request limit.** With `N` active instances, one caller may be
  admitted roughly `N × MCP_RATE_LIMIT_MAX` times per window, and recycling can raise
  that further;
- a cache hit is possible only when the request reaches an instance that already cached
  the same response, so hit rate will be lower and each instance can repeat the same
  upstream request;
- a circuit opening on one instance does not stop other instances from calling the same
  failing upstream; and
- every cold start resets the limiter, cache, and circuit state.

This is meaningful per-instance protection, not fleet-wide protection. Do not describe
the deployed endpoint as globally rate-limited or globally circuit-broken.

## Shared-store seam

The in-memory defaults can be replaced without changing tool handlers:

1. Implement a shared `CacheStore` using a backend with expiring values, then construct
   the exported upstream fetch with it in `src/resilience/upstream-fetch.ts`.
2. Implement `RateLimitStore.consume()` with an atomic prune/count/add operation in a
   shared backend, then inject its `SlidingWindowRateLimiter` into the serverless handler
   and long-running HTTP server.

No shared backend was added because no backend or credentials were supplied. The circuit
breaker can remain per instance, but it must not be represented as global.

## Operator decisions before launch

- Decide whether the documented per-instance resilience is acceptable. If not, provide
  and configure shared cache and rate-limit stores before advertising the endpoint.
- Set cache freshness, rate limits, and breaker thresholds based on acceptable load for
  SC Ethics, VREMS, and election history.
- Populate `MCP_ALLOWED_ORIGINS` for browser-originating clients. Server-to-server clients
  usually omit `Origin` and do not need an entry.
- Decide whether the endpoint remains unauthenticated, and review each upstream site's
  automation/terms policy before centralizing traffic.
- Add monitoring for cache hit rate, upstream `429`/`5xx` responses, circuit-open errors,
  request latency, and rate-limit rejections.
- For a long-running host, use a TCP health check unless a separate health route is
  deliberately added. The Vercel configuration does not add a health route.

Before release, run `npm test` and `npm run build`, invoke the exported function with an
MCP `initialize` plus one mocked tool call, and perform any live smoke test only after the
terms review and with a deliberately small request budget.
