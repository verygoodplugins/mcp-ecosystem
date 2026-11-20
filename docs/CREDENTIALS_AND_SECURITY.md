# Credentials, Remote Transport, and Security Standard

Status: v1 (2026-11). Applies to every server in `server-inventory.json`.
Machine-readable values live in `config/ecosystem-policy.json` →
`standards.credentials` and `standards.remote`, and are checked by
`scripts/audit-server.sh`. Self-hosting recipes live in
`docs/SELF_HOSTING.md`.

## 1. Credential handling

### Naming

| Purpose                     | Variable                                                                                      | Notes                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Upstream API credential     | `<SERVICE>_API_TOKEN`, `<SERVICE>_API_KEY`, `<SERVICE>_CLIENT_ID` / `<SERVICE>_CLIENT_SECRET` | Use the provider's own term; always prefixed.                                                |
| Upstream base URL           | `<SERVICE>_API_URL`                                                                           | Never embeds credentials.                                                                    |
| Remote MCP caller keys      | `<SERVICE>_HTTP_CALLER_KEYS`                                                                  | Comma-separated `name:key` pairs.                                                            |
| Remote MCP caller keys file | `<SERVICE>_HTTP_CALLER_KEYS_FILE`                                                             | Optional. Path to a `0600` file with one `name:key` per line. Wins over the inline variable. |
| HTTP bind / port / hosts    | `<SERVICE>_HTTP_HOST`, `<SERVICE>_HTTP_PORT`, `<SERVICE>_HTTP_ALLOWED_HOSTS`                  | Host defaults to `127.0.0.1`.                                                                |
| Rate limit                  | `<SERVICE>_HTTP_RATE_LIMIT_PER_MINUTE`                                                        | Default 600 per caller.                                                                      |
| Transport switch            | `<SERVICE>_TRANSPORT`                                                                         | `stdio` (default) or `http`.                                                                 |

`<SERVICE>` is the upper-snake service name (`EVERNOTE`, `TOGGL`,
`FREESCOUT`). Prefixes keep a shared `.env` or launchd plist unambiguous
when several servers run on one host. Do not invent unprefixed names such
as `API_KEY` or `TOKEN`. Legacy names may be read as fallbacks for one major
release and must log a one-line deprecation notice to stderr (never the
value).

`MCP_HTTP_AUTH_TOKEN` from the first SELF_HOSTING draft is superseded by
`<SERVICE>_HTTP_CALLER_KEYS` (no server on `main` shipped it).

### Rules

1. **Never in the repo.** No credentials in source, tests, fixtures,
   snapshots, `server.json`, `manifest.json`, plugin manifests, or docs.
   Ship `.env.example` with every variable and empty or obviously fake
   values. `.env*` (except `.env.example`), `*.pem`, `*.key`, and
   `.mcpregistry_*` are gitignored.
2. **Never in output.** Credentials never appear in logs, tool results,
   error messages, `/health`, `/metrics`, stack traces, or telemetry.
   Log caller **names**, not keys. Redact `Authorization`, `Cookie`,
   `X-Api-Key`, `CF-Access-Client-Secret`, and any `*token*`/`*secret*`
   field before logging an upstream request or response.
3. **Lazy validation.** Read credentials when a tool runs, not at import,
   so `tools/list` works without them; return `isError: true` with the
   variable **name** that is missing.
4. **Local storage.** On macOS, store long-lived secrets in the login
   Keychain and have the launcher (launchd wrapper, shell profile) export
   them; do not keep plaintext copies in dotfiles. Linux hosts use the
   platform secret store or a `0600` env file outside the repo. Plugin
   variables are set in the client's Configure UI, never committed.
5. **Rotation.** Every credential must be rotatable without a code change:
   update the store, restart the process. Caller keys rotate one caller at a
   time by adding the new `name:key`, moving the client, then removing the
   old pair. Rotate immediately after any suspected exposure (a key in a
   log, trace, screenshot, chat, or commit), and treat a committed secret as
   burned even after a history rewrite.
6. **Least privilege.** Request the narrowest upstream scopes the tools
   need. Document the scopes in the README Configuration section.

## 2. Remote transport contract

A server that offers remote access must implement all of this before it is
listed as self-hostable in `docs/SELF_HOSTING.md`.

| Requirement          | Standard                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport            | MCP Streamable HTTP at `POST /mcp` (plus `GET`/`DELETE` for sessions). stdio stays the default transport.                                                                                                                           |
| Health               | `GET /health` → `200 {"status":"ok"}`. Unauthenticated, no version, config, or upstream details. `/healthz` is an accepted alias.                                                                                                   |
| Auth                 | `Authorization: Bearer <key>` checked against `<SERVICE>_HTTP_CALLER_KEYS`. Compare SHA-256 digests with a constant-time compare (`crypto.timingSafeEqual` / `hmac.compare_digest`). Respond `401` with `WWW-Authenticate: Bearer`. |
| Per-caller identity  | Each client gets its own named key. Sessions are bound to the caller that opened them. Logs and rate limits use the caller name.                                                                                                    |
| Unauthenticated mode | Refuse to start without keys unless `<SERVICE>_HTTP_ALLOW_UNAUTHENTICATED=true` **and** bound to loopback.                                                                                                                          |
| Bind                 | Default `127.0.0.1`. Non-loopback binds require keys.                                                                                                                                                                               |
| DNS rebinding        | Host-header validation: SDK `localhostHostValidation()` on loopback, `hostHeaderValidation(<SERVICE>_HTTP_ALLOWED_HOSTS)` otherwise.                                                                                                |
| Rate limits          | Per caller, default 600/min, `429` with `RateLimit` headers; missing/invalid keys share one bucket. Cap body size and open sessions (`503` when full).                                                                              |
| Upstream backoff     | Honor provider `429`/`Retry-After` with bounded exponential backoff and jitter; serialize or queue calls where the provider rate-limits per account. Surface a retry hint in `isError` text.                                        |
| Errors               | Sanitized: no stack traces, local paths, credentials, or raw upstream bodies. Return a short message and a stable error code.                                                                                                       |
| Credentials in URLs  | Never. Keys go in headers only.                                                                                                                                                                                                     |

### Proxies and Cloudflare Access

The reference deployment (`mcp-evernote`) runs as a loopback daemon on the
owner's machine; the AutoHub proxy forwards `/mcp/<service>` to it, and a
Cloudflare Tunnel publishes the hub behind Cloudflare Access.

- Access is a **second** layer, never a replacement for caller keys. The
  server still requires its own bearer key on every request.
- Machine clients authenticate to Access with a service token
  (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers) scoped to the
  one application; humans use the Access login.
- The proxy forwards `Authorization`, strips Access headers before the
  upstream, and must not log either.
- Because every request reaches the server from `127.0.0.1`, rate limits and
  session ownership key on the caller name, never the client IP.

## 3. Reporting and support

`.github/SECURITY.md` is a managed hygiene file rendered from
`templates/<type>/.github/SECURITY.md` and propagated by
`scripts/propagate-templates.sh`. It routes reports to GitHub Private
Vulnerability Reporting and states the credential commitments above, so a
change to this standard is made once in the template and rolled out to every
server.
