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
    /name: Dependabot Auto-Merge/,
  );
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /uses: verygoodplugins\/\.github\/\.github\/workflows\/dependabot-auto-merge\.yml@main/,
  );
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/,
  );
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /issues: write/,
  );
  assert.match(
    files[".github/workflows/dependabot-auto-merge.yml"],
    /github\.event_name == 'workflow_run'/,
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

  assert.match(ci, /node-version: \["24"\]/);
  assert.match(ci, /node-version: \$\{\{ matrix\.node-version \}\}/);
  assert.doesNotMatch(ci, /node-version:\s*["']?(?:18|20|22)["']?/);

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

test("renders GitHub Packages mirror publish job for TypeScript releases", () => {
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
  const releaseWorkflow = files[".github/workflows/release-please.yml"];

  assert.match(releaseWorkflow, /npm publish --provenance --access public/);
  assert.match(releaseWorkflow, /actions\/checkout@v6/);
  assert.match(releaseWorkflow, /actions\/setup-node@v6/);
  assert.match(releaseWorkflow, /npm ci/);
  assert.doesNotMatch(releaseWorkflow, /ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION/);
  assert.match(releaseWorkflow, /gh-packages-publish:/);
  assert.match(releaseWorkflow, /needs: \[release-please, npm-publish\]/);
  assert.match(releaseWorkflow, /packages: write/);
  assert.match(releaseWorkflow, /continue-on-error: true/);
  assert.match(releaseWorkflow, /registry-url: "https:\/\/npm\.pkg\.github\.com"/);
  assert.match(releaseWorkflow, /scope: "@verygoodplugins"/);
  assert.match(
    releaseWorkflow,
    /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
  );
});

test("renders structured docs dispatch for TypeScript releases when configured", () => {
  const server = {
    name: "mcp-automem",
    type: "typescript",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "ts-vitest",
    releaseProfile: "release-please-manifest",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
    docsDispatch: {
      repository: "verygoodplugins/automem-website",
      eventType: "docs-update",
      fileDocMapUrl:
        "https://raw.githubusercontent.com/verygoodplugins/automem-website/main/scripts/file-doc-map.json",
    },
  };

  const profiles = resolveServerProfiles(server);
  const files = renderManagedFiles(server, profiles);
  const releaseWorkflow = files[".github/workflows/release-please.yml"];

  assert.match(releaseWorkflow, /docs-dispatch:/);
  assert.match(releaseWorkflow, /DOCS_REPOSITORY: verygoodplugins\/automem-website/);
  assert.match(releaseWorkflow, /DOCS_EVENT_TYPE: docs-update/);
  assert.match(releaseWorkflow, /FILE_DOC_MAP_URL: "https:\/\/raw\.githubusercontent\.com\/verygoodplugins\/automem-website\/main\/scripts\/file-doc-map\.json"/);
  assert.match(releaseWorkflow, /grep -v -xF "\$CURR_TAG"/);
  assert.match(releaseWorkflow, /repos\/\$DOCS_REPOSITORY\/dispatches" --input -/);
  assert.match(releaseWorkflow, /changed_files: \(\$changed_files \| fromjson\)/);
  assert.match(
    releaseWorkflow,
    /affected_docs: \(try \(\$affected_docs \| fromjson\) catch \$affected_docs\)/,
  );
  assert.match(releaseWorkflow, /compare_url: \$compare_url/);
});

test("renders GitHub hygiene files when hygieneTemplates feature is enabled", () => {
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

  const files = renderManagedFiles(server);

  assert.match(files[".github/CODEOWNERS"], /@jack-arturo/);
  assert.match(files[".github/SECURITY.md"], /Security Policy/);
  assert.match(
    files[".github/SECURITY.md"],
    /security\/advisories\/new/,
  );
  assert.match(files[".github/PULL_REQUEST_TEMPLATE.md"], /## Summary/);
  assert.match(files[".github/ISSUE_TEMPLATE/config.yml"], /blank_issues_enabled: false/);
  assert.match(files[".github/ISSUE_TEMPLATE/bug_report.yml"], /name: Bug report/);
  assert.match(
    files[".github/ISSUE_TEMPLATE/feature_request.yml"],
    /name: Feature request/,
  );
});

test("hygiene files render for python servers too", () => {
  const server = {
    name: "mcp-weather",
    type: "python",
    packageLayout: "root",
    packagePath: ".",
    ciProfile: "py-src-layout",
    releaseProfile: "pypi-oidc",
    securityProfile: "strict",
    templateTier: "compatible",
    propagate: true,
  };

  const files = renderManagedFiles(server);

  assert.match(files[".github/CODEOWNERS"], /@jack-arturo/);
  assert.match(files[".github/SECURITY.md"], /Security Policy/);
  assert.match(files[".github/PULL_REQUEST_TEMPLATE.md"], /pytest/);
  assert.match(files[".github/ISSUE_TEMPLATE/bug_report.yml"], /Python version/);
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
