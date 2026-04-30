import test from "node:test";
import assert from "node:assert/strict";

import {
  renderManagedFiles,
  resolveServerProfiles,
} from "../lib/ecosystem-config.mjs";

function assertNoVersionUpdateWildcardGroup(dependabotConfig) {
  const groupsSection =
    dependabotConfig.match(/\n    groups:\n([\s\S]*?)\n    commit-message:/)?.[1] ??
    "";
  const groupBlocks = groupsSection.split(/\n      (?=[a-z0-9-]+:)/);

  for (const groupBlock of groupBlocks) {
    if (
      groupBlock.includes("applies-to: version-updates") &&
      /patterns:\n(?:\s+- .+\n)*\s+- "\*"/.test(groupBlock)
    ) {
      assert.fail(`Version-update group must not match every npm package:\n${groupBlock}`);
    }
  }
}

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
  assert.doesNotMatch(files[".github/dependabot.yml"], /dev-dependencies:/);
  assert.doesNotMatch(files[".github/dependabot.yml"], /runtime-dependencies:/);
  assert.match(files[".github/dependabot.yml"], /open-pull-requests-limit: 2/);
  assert.match(files[".github/workflows/pr-title.yml"], /name: PR Title/);
  assert.match(files[".github/workflows/pr-title.yml"], /name: Lint PR Title/);
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /name: Dependabot auto-merge/,
  );
});

test("renders TypeScript CI matrix and scoped npm Dependabot groups", () => {
  const server = {
    name: "mcp-evernote",
    type: "typescript",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "ts-vitest",
    releaseProfile: "release-please-manifest",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);
  const ci = files[".github/workflows/ci.yml"];
  const dependabot = files[".github/dependabot.yml"];

  assert.match(ci, /node-version: \["22", "24"\]/);
  assert.match(ci, /node-version: \$\{\{ matrix\.node-version \}\}/);
  assert.doesNotMatch(ci, /node-version:\s*["']?(?:18|20)["']?/);

  assert.match(dependabot, /security-updates:[\s\S]*applies-to: security-updates/);
  assert.match(dependabot, /security-updates:[\s\S]*patterns:\n\s+- "\*"/);
  assert.match(dependabot, /production-minor-patch:[\s\S]*dependency-type: "production"[\s\S]*update-types:\n\s+- "minor"\n\s+- "patch"/);
  assert.match(dependabot, /development-minor-patch:[\s\S]*exclude-patterns:/);
  assert.match(dependabot, /eslint-minor-patch:/);
  assert.match(dependabot, /typescript-minor-patch:/);
  assert.match(dependabot, /test-tooling-minor-patch:/);
  assert.doesNotMatch(dependabot, /\n    ignore:\n/);
  assertNoVersionUpdateWildcardGroup(dependabot);
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
  assert.match(files[".github/workflows/ci.yml"], /jobs:\n  test:/);
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

  assert.match(files[".github/workflows/ci.yml"], /jobs:\n  test:/);
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
