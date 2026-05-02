# Self-Hosting VGP MCP Servers

Draft v1. This guide captures the current AutoMem precedent and the mcp-toggl self-host path. Treat it as implementation guidance until mcp-toggl ships against it.

## Which servers can be self-hosted?

| Server        | Self-hostable | Image                                        | Notes                                                                                      |
| ------------- | ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| mcp-automem   | Yes           | `ghcr.io/verygoodplugins/mcp-automem:stable` | Multi-service deployment with AutoMem API, Qdrant, and FalkorDB.                           |
| mcp-toggl     | Yes           | `ghcr.io/verygoodplugins/mcp-toggl:stable`   | Single-service, per-user deployment using a server-side Toggl token plus MCP bearer token. |
| mcp-pirsch    | Candidate     | -                                            | Needs remote transport, image, tests, and privacy review.                                  |
| mcp-edd       | Candidate     | -                                            | Needs remote transport, image, tests, and auth review.                                     |
| mcp-local-wp  | No            | -                                            | Requires local SQLite and local WordPress environment access.                              |
| mcp-freescout | Candidate     | -                                            | Needs remote transport, image, tests, and auth review.                                     |
| mcp-evernote  | Candidate     | -                                            | Needs remote transport, image, tests, and auth review.                                     |

## Pre-flight checklist

Do not ship a VGP MCP server as remote/self-hostable until it has:

- Test coverage at or above 50%.
- Privacy review for any tool that surfaces user-private data.
- Sanitized error responses that do not leak local paths, credentials, stack traces, or raw upstream bodies.
- MCP SDK 1.29 or newer.
- Streamable HTTP endpoint, normally `POST /mcp`.
- Health endpoint, normally `GET /health`.
- Pre-built GHCR image with `:stable` and release version tags.
- README section for upstream API auth, MCP endpoint auth, env vars, and connector URL.

## Deployment options

### Generic Docker

```bash
docker run --rm \
  -p 3000:3000 \
  -e SERVER_TOKEN_ENV=xxx \
  -e MCP_HTTP_AUTH_TOKEN=change-this-random-secret \
  ghcr.io/verygoodplugins/mcp-{name}:stable
```

Replace `SERVER_TOKEN_ENV` with the server-specific upstream token variable from that server's README. For mcp-toggl, use `TOGGL_API_TOKEN`. `MCP_HTTP_AUTH_TOKEN` protects the remote MCP endpoint itself and should be sent by the connector as a bearer token, not placed in the URL.

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
fly secrets set SERVER_TOKEN_ENV=xxx MCP_HTTP_AUTH_TOKEN=change-this-random-secret
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
	      MCP_HTTP_AUTH_TOKEN: change-this-random-secret
	    ports:
      - "3000:3000"
```

Put HTTPS in front of the container with Caddy, nginx, Traefik, or your host's managed proxy.

## Connecting from Claude Desktop

1. Deploy the server and confirm `GET /health` returns `ok: true`.
2. Open Claude Desktop.
3. Go to Customize -> Connectors -> Add Custom Connector.
4. Use the Streamable HTTP URL:

```text
https://your-deployment.example.com/mcp
```

Auth is per server. For mcp-toggl, configure `TOGGL_API_TOKEN` on the deployment itself and do not put the Toggl token in the URL. Configure the connector to send `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` for the MCP endpoint.

## Troubleshooting

| Symptom                        | Check                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Connector cannot reach server  | Confirm DNS, HTTPS, and the `/mcp` path.                                               |
| Health check fails             | Confirm required env vars are set and the container is listening on the expected port. |
| Client says transport mismatch | Use Streamable HTTP at `/mcp`; do not point the client at `/health`.                   |
| Auth fails                     | Regenerate the upstream API token or MCP bearer token and update the deployment secret. |
| Privacy concern in output      | Confirm raw/private fields are opt-in and default output is redacted or summary-only.  |
| Rate limits                    | Prefer cache/list tools and avoid repeated heavy report calls in one chat turn.        |

## Positioning

Self-hostable VGP MCP servers should ship with a known-good readiness checklist before going remote. The differentiator is not just "has HTTP transport"; it is tests, privacy defaults, sanitized errors, and a pre-built deployment path.
