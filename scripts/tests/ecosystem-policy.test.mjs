import test from "node:test";
import assert from "node:assert/strict";

import {
  renderManagedFiles,
  resolveServerProfiles,
} from "../lib/ecosystem-config.mjs";

test("renders monorepo python managed files from inventory-style config", () => {
  const server = {
    name: "whatsapp-mcp",
    type: "python",
    packageLayout: "monorepo",
    packagePath: "whatsapp-mcp-server",
    ciProfile: "py-monorepo",
    releaseProfile: "pypi-oidc",
    securityProfile: "bandit-root",
    templateTier: "compatible",
    propagate: true,
    coverageTargets: ["main", "whatsapp", "audio"],
    dependabot: {
      ecosystems: [
        { packageEcosystem: "pip", directory: "/whatsapp-mcp-server" },
        { packageEcosystem: "gomod", directory: "/whatsapp-bridge" },
        { packageEcosystem: "github-actions", directory: "/" },
      ],
    },
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);

  assert.equal(profiles.ci.id, "py-monorepo");
  assert.match(
    files[".github/workflows/ci.yml"],
    /working-directory: whatsapp-mcp-server/,
  );
  assert.match(
    files[".github/workflows/ci.yml"],
    /pytest --cov=main --cov=whatsapp --cov=audio --cov-report=xml/,
  );
  assert.match(files[".github/workflows/ci.yml"], /name: Python CI/);
  assert.match(
    files[".github/workflows/ci.yml"],
    /files: whatsapp-mcp-server\/coverage\.xml/,
  );
  assert.match(files[".github/dependabot.yml"], /package-ecosystem: "gomod"/);
  assert.match(
    files[".github/dependabot.yml"],
    /directory: "\/whatsapp-mcp-server"/,
  );
  assert.match(files[".github/workflows/pr-title.yml"], /name: PR Title/);
  assert.match(files[".github/workflows/pr-title.yml"], /name: Lint PR Title/);
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /name: Dependabot auto-merge/,
  );
});

test("renders release-please simple workflow for jest repos", () => {
  const server = {
    name: "mcp-freescout",
    type: "typescript",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "ts-jest",
    releaseProfile: "release-please-simple",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
    allowOverrides: ["eslintConfig", "vitestConfig"],
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);

  assert.equal(profiles.release.id, "release-please-simple");
  assert.match(files[".github/workflows/ci.yml"], /name: TypeScript CI/);
  assert.match(files[".github/workflows/ci.yml"], /run: npm test/);
  assert.doesNotMatch(files[".github/workflows/ci.yml"], /test:coverage/);
  assert.match(
    files[".github/workflows/release-please.yml"],
    /release-type: node/,
  );
  assert.doesNotMatch(
    files[".github/workflows/release-please.yml"],
    /manifest-file/,
  );
  assert.equal(files["eslint.config.mjs"], undefined);
  assert.equal(files["vitest.config.ts"], undefined);
});

test("does not render vitest config for ts-jest repos by profile", () => {
  const server = {
    name: "mcp-local-wp",
    type: "typescript",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "ts-jest",
    releaseProfile: "release-please-simple",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);

  assert.match(files[".github/workflows/ci.yml"], /name: TypeScript CI/);
  assert.equal(files["vitest.config.ts"], undefined);
  assert.match(files[".github/workflows/ci.yml"], /run: npm test/);
  assert.doesNotMatch(files[".github/workflows/ci.yml"], /test:coverage/);
});

test("renders extension release and integration CI for mcp-edd style repos", () => {
  const server = {
    name: "mcp-edd",
    type: "typescript",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "ts-jest-integration",
    releaseProfile: "release-please-manifest-extension",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
    desktopExtension: true,
    integrationTestSecrets: ["EDD_API_URL", "EDD_API_KEY", "EDD_API_TOKEN"],
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);

  assert.match(files[".github/workflows/ci.yml"], /Integration tests/);
  assert.match(files[".github/workflows/ci.yml"], /EDD_API_URL/);
  assert.match(
    files[".github/workflows/release-please.yml"],
    /build-extension:/,
  );
  assert.match(
    files[".github/workflows/release-please.yml"],
    /npm run build:extension/,
  );
});

test("renders go-aware monorepo workflows for whatsapp-mcp style repos", () => {
  const server = {
    name: "whatsapp-mcp",
    type: "python",
    packageLayout: "monorepo",
    packagePath: "whatsapp-mcp-server",
    ciProfile: "py-monorepo-go",
    releaseProfile: "release-please-manifest-go-artifacts",
    securityProfile: "bandit-root-go",
    templateTier: "compatible",
    propagate: true,
    goPackagePath: "whatsapp-bridge",
    goVersion: "1.25",
    versionCheckScript: ".github/scripts/check_versions.py",
    coverageTargets: ["main", "whatsapp", "audio"],
    dependabot: {
      ecosystems: [
        { packageEcosystem: "pip", directory: "/whatsapp-mcp-server" },
        { packageEcosystem: "gomod", directory: "/whatsapp-bridge" },
        { packageEcosystem: "github-actions", directory: "/" },
      ],
    },
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);

  assert.match(files[".github/workflows/ci.yml"], /Version Consistency/);
  assert.match(files[".github/workflows/ci.yml"], /Go Lint/);
  assert.match(
    files[".github/workflows/security.yml"],
    /CodeQL Analysis \(Go\)/,
  );
  assert.match(files[".github/workflows/security.yml"], /govulncheck/);
  assert.match(
    files[".github/workflows/release-please.yml"],
    /Publish Release Artifacts/,
  );
  assert.match(
    files[".github/workflows/release-please.yml"],
    /ref: \$\{\{ needs\.release-please\.outputs\.sha \}\}/,
  );
  assert.match(
    files[".github/workflows/release-please.yml"],
    /tag_name: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}/,
  );
  assert.match(
    files[".github/workflows/release.yml"],
    /Release \(Manual Fallback\)/,
  );
  assert.match(
    files[".github/workflows/release.yml"],
    /ref: \$\{\{ github\.event\.inputs\.tag \}\}/,
  );
  assert.match(
    files[".github/workflows/release.yml"],
    /GOOS=linux GOARCH=amd64/,
  );
});
