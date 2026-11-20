# Self-Hosting VGP MCP Servers

v2 (2026-11). The remote contract (auth, health, rate limits, errors, proxies) is defined in [`CREDENTIALS_AND_SECURITY.md`](CREDENTIALS_AND_SECURITY.md) and checked by `scripts/audit-server.sh`; this guide covers deployment. Reference implementations: `mcp-evernote` (loopback daemon behind a proxy) and AutoMem (hosted sidecar).

## Which servers can be self-hosted?

| Server        | Remote today      | Shape                                                                                 | Notes                                                                                                                                                                                                                |
| ------------- | ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mcp-automem   | Yes               | Hosted sidecar + `ghcr.io/verygoodplugins/mcp-automem:stable`                         | Multi-service deployment with AutoMem API, Qdrant, and FalkorDB; remote MCP lives in the AutoMem service sidecar.                                                                                                    |
| mcp-evernote  | Yes (self-hosted) | Loopback daemon, `127.0.0.1:3100/mcp`, behind the AutoHub proxy and Cloudflare Access | Streamable HTTP with per-caller `EVERNOTE_HTTP_CALLER_KEYS`, constant-time auth, per-caller rate limit, host validation, `/healthz`. No GHCR image yet (needs a `/health` alias and an image to be container-ready). |
| whatsapp-mcp  | Partial           | `WHATSAPP_MCP_TRANSPORT=http` on loopback                                             | Has Streamable HTTP but no MCP endpoint auth, health route, or rate limit. Loopback only until it meets the contract.                                                                                                |
| mcp-toggl     | Planned           | -                                                                                     | The single-service, per-user design is not on `main` yet (no HTTP transport or image).                                                                                                                               |
| mcp-pirsch    | Candidate         | -                                                                                     | Needs remote transport, image, tests, and privacy review.                                                                                                                                                            |
| mcp-edd       | Candidate         | -                                                                                     | Needs remote transport, image, tests, and auth review.                                                                                                                                                               |
| mcp-freescout | Candidate         | -                                                                                     | Needs remote transport, image, tests, and auth review.                                                                                                                                                               |
| mcp-local-wp  | No                | -                                                                                     | Requires local SQLite and local WordPress environment access.                                                                                                                                                        |

## Pre-flight checklist

Do not ship a VGP MCP server as remote/self-hostable until it has:

- Test coverage at or above 50%.
- Privacy review for any tool that surfaces user-private data.
- Sanitized error responses that do not leak local paths, credentials, stack traces, or raw upstream bodies.
- MCP SDK 1.29 or newer.
- Streamable HTTP endpoint at `POST /mcp`.
- Health endpoint at `GET /health` (unauthenticated, `{"status":"ok"}` only; `/healthz` accepted as an alias).
- Per-caller bearer keys (`<SERVICE>_HTTP_CALLER_KEYS`) with constant-time comparison, per-caller rate limits, and Host-header validation.
- Pre-built GHCR image with `:stable` and release version tags.
- README section for upstream API auth, MCP endpoint auth, env vars, and connector URL.

## Deployment options

### Generic Docker

```bash
docker run --rm \
  -p 3000:3000 \
  -e SERVER_TOKEN_ENV=xxx \
  -e <SERVICE>_HTTP_CALLER_KEYS=claude:change-this-random-secret \
  ghcr.io/verygoodplugins/mcp-{name}:stable
```

Replace `SERVER_TOKEN_ENV` with the server-specific upstream token variable from that server's README (for example `TOGGL_API_TOKEN`), and `<SERVICE>` with the server prefix (`TOGGL`, `EVERNOTE`). Each `name:key` pair in `<SERVICE>_HTTP_CALLER_KEYS` is one client; the client sends its key as a bearer token, never in the URL. Generate keys with `openssl rand -hex 24`. Set `<SERVICE>_HTTP_HOST=0.0.0.0` inside containers only; the default is loopback.

### Railway

Use the server README's Railway button when available. Railway should deploy the pre-built `:stable` image, not rebuild source on every deploy.

Railway deploy links should include:

```text
?referralCode=VuFE6g&utm_medium=integration&utm_source=github&utm_campaign=generic
```

### Fly.io

Fly works well for per-user idle services.

```bash
fly launch --image ghcr.io/verygoodplugins/mcp-{name}:stable
fly secrets set SERVER_TOKEN_ENV=xxx <SERVICE>_HTTP_CALLER_KEYS=claude:change-this-random-secret
fly deploy
```

Set the app's exposed port to the server's HTTP port, normally `3000`.

### Render

Create a Web Service from the GHCR image and set the required upstream token and MCP bearer-token env vars. Use `/health` as the health check path.

### Coolify

Create a Docker image service, set the image to `ghcr.io/verygoodplugins/mcp-{name}:stable`, expose the server port, and add the required upstream token and MCP bearer-token env vars.

### Bare VPS

```yaml
services:
  mcp-server:
    image: ghcr.io/verygoodplugins/mcp-{name}:stable
    restart: unless-stopped
    environment:
      SERVER_TOKEN_ENV: xxx
      <SERVICE>_HTTP_CALLER_KEYS: "claude:change-this-random-secret"
    ports:
      - "3000:3000"
```

Put HTTPS in front of the container with Caddy, nginx, Traefik, or your host's managed proxy.

### Local daemon behind a proxy (mcp-evernote pattern)

For servers that hold a personal upstream session, run one long-lived process on the owner's machine instead of a container:

1. Run the server in HTTP mode on loopback (`<SERVICE>_TRANSPORT=http`, default host `127.0.0.1`) under launchd or systemd. The launcher reads caller keys from the Keychain or a `0600` file and exports `<SERVICE>_HTTP_CALLER_KEYS`; keys never live in the plist or repo.
2. Local clients (Cursor, Claude Desktop, the hub) connect to `http://127.0.0.1:<port>/mcp`, each with its own caller key.
3. For off-machine clients, a proxy (AutoHub `/mcp/<service>`) forwards to the loopback port and a Cloudflare Tunnel publishes it behind Cloudflare Access. Machine clients add an Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) **and** still send their caller key.
4. Rotate a caller by adding its new pair, updating that client, then removing the old pair and restarting the daemon.

## Connecting from Claude Desktop

1. Deploy the server and confirm `GET /health` returns `ok: true`.
2. Open Claude Desktop.
3. Go to Customize -> Connectors -> Add Custom Connector.
4. Use the Streamable HTTP URL:

```text
https://your-deployment.example.com/mcp
```

Configure the upstream credential (for example `TOGGL_API_TOKEN`) on the deployment itself, never in the URL. Configure the connector to send `Authorization: Bearer <caller key>` for the MCP endpoint. Cursor and Claude Code users should prefer the server's plugin (see [`PLUGINS.md`](PLUGINS.md)), which declares the URL and key as configurable variables.

## Troubleshooting

| Symptom                        | Check                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Connector cannot reach server  | Confirm DNS, HTTPS, and the `/mcp` path.                                                                                                 |
| Health check fails             | Confirm the process is listening on the expected host/port; `/health` needs no auth.                                                     |
| Client says transport mismatch | Use Streamable HTTP at `/mcp`; do not point the client at `/health`.                                                                     |
| Auth fails (401)               | Check the client sends `Authorization: Bearer <key>` and that its `name:key` pair is in `<SERVICE>_HTTP_CALLER_KEYS`; rotate if exposed. |
| 403 from Cloudflare            | The Access service token is missing, expired, or not allowed on that application.                                                        |
| 429                            | Per-caller rate limit hit; back off and retry, or raise `<SERVICE>_HTTP_RATE_LIMIT_PER_MINUTE`.                                          |
| Privacy concern in output      | Confirm raw/private fields are opt-in and default output is redacted or summary-only.                                                    |
| Rate limits                    | Prefer cache/list tools and avoid repeated heavy report calls in one chat turn.                                                          |

## Positioning

Self-hostable VGP MCP servers should ship with a known-good readiness checklist before going remote. The differentiator is not just "has HTTP transport"; it is tests, privacy defaults, sanitized errors, and a pre-built deployment path.
