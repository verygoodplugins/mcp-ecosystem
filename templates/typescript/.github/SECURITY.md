# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue.

Instead, report it privately via [GitHub Security Advisories](https://github.com/{repo_slug}/security/advisories/new). We aim to respond within 3 business days.

For urgent issues you may also email [support@verygoodplugins.com](mailto:support@verygoodplugins.com).

## Supported Versions

The latest minor release on the default branch receives security updates. Older versions may be patched on a case-by-case basis.

## How This Server Handles Credentials

- Credentials come only from environment variables or the client's plugin settings. None are stored in this repository.
- Credentials must never appear in logs, tool results, error messages, or health output. Treat any case where they do as a vulnerability.
- Over HTTP, give each client its own bearer key and keep unauthenticated mode on loopback only. Keys rotate one caller at a time without a code change.
- If you think a credential was exposed through this server, rotate it first, then report it privately as described above.

The full standard is in [mcp-ecosystem](https://github.com/verygoodplugins/mcp-ecosystem/blob/main/docs/CREDENTIALS_AND_SECURITY.md).

## Disclosure Policy

We follow coordinated disclosure: we'll work with you on a fix and credit you in the release notes if you wish.
