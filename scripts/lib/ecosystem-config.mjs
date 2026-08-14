import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import policy from "../../config/ecosystem-policy.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const inventoryPath = path.join(repoRoot, "server-inventory.json");

export function loadInventory(targetPath = inventoryPath) {
  const inventory = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  return inventory.servers.map(normalizeServerConfig);
}

export function getServerConfig(serverName, targetPath = inventoryPath) {
  const server = loadInventory(targetPath).find(
    (entry) => entry.name === serverName,
  );
  if (!server) {
    throw new Error(`Unknown server in inventory: ${serverName}`);
  }
  return server;
}

export function normalizeServerConfig(server) {
  const packagePath = server.packagePath ?? server.baselinePath ?? ".";
  const packageLayout =
    server.packageLayout ?? (packagePath === "." ? "root" : "subdir");
  const ciProfile =
    server.ciProfile ??
    inferCiProfile(server.type, packageLayout, server.coverageTargets);
  const releaseProfile =
    server.releaseProfile ?? inferReleaseProfile(server.type);
  const securityProfile =
    server.securityProfile ?? inferSecurityProfile(server.type, packageLayout);

  return {
    ...server,
    packagePath,
    packageLayout,
    ciProfile,
    releaseProfile,
    securityProfile,
    templateTier: server.templateTier ?? "compatible",
    propagate: server.propagate ?? true,
    allowOverrides: server.allowOverrides ?? [],
    coverageTargets:
      server.coverageTargets ?? inferCoverageTargets(server, packagePath),
    dependabot: server.dependabot ?? {
      ecosystems: defaultDependabotEcosystems({
        ...server,
        type: server.type,
        packagePath,
      }),
    },
  };
}

export function resolveServerProfiles(server) {
  const normalized = normalizeServerConfig(server);
  const ci = policy.ciProfiles[normalized.ciProfile];
  const release = policy.releaseProfiles[normalized.releaseProfile];
  const security = policy.securityProfiles[normalized.securityProfile];
  const tierFeatures = policy.templateTiers[normalized.templateTier];

  if (!ci) {
    throw new Error(`Unknown ciProfile: ${normalized.ciProfile}`);
  }
  if (!release) {
    throw new Error(`Unknown releaseProfile: ${normalized.releaseProfile}`);
  }
  if (!security) {
    throw new Error(`Unknown securityProfile: ${normalized.securityProfile}`);
  }
  if (!tierFeatures) {
    throw new Error(`Unknown templateTier: ${normalized.templateTier}`);
  }

  return { ci, release, security, tierFeatures };
}

export function renderManagedFiles(
  server,
  profiles = resolveServerProfiles(server),
) {
  const normalized = normalizeServerConfig(server);
  const files = {};

  if (shouldManageFeature("prTitleWorkflow", normalized, profiles)) {
    files[".github/workflows/pr-title.yml"] = renderStaticWorkflowTemplate(
      normalized.type,
      "pr-title.yml",
    );
  }
  if (
    shouldManageFeature("dependabotAutoMergeWorkflow", normalized, profiles)
  ) {
    files[".github/workflows/dependabot-auto-merge.yml"] =
      renderStaticWorkflowTemplate(
        normalized.type,
        "dependabot-auto-merge.yml",
      );
  }
  if (shouldManageFeature("ciWorkflow", normalized, profiles)) {
    files[".github/workflows/ci.yml"] = renderCiWorkflow(normalized, profiles);
  }
  if (shouldManageFeature("securityWorkflow", normalized, profiles)) {
    files[".github/workflows/security.yml"] = renderSecurityWorkflow(
      normalized,
      profiles,
    );
  }
  if (shouldManageFeature("dependabotConfig", normalized, profiles)) {
    files[".github/dependabot.yml"] = renderDependabotConfig(normalized);
  }
  if (shouldManageFeature("releaseWorkflow", normalized, profiles)) {
    Object.assign(files, renderReleaseFiles(normalized, profiles));
  }
  if (
    normalized.type === "typescript" &&
    shouldManageFeature("eslintConfig", normalized, profiles)
  ) {
    files["eslint.config.mjs"] = renderTypescriptEslintConfig();
  }
  if (
    normalized.type === "typescript" &&
    profiles.ci.managedFeatures?.includes("vitestConfig") &&
    shouldManageFeature("vitestConfig", normalized, profiles)
  ) {
    files["vitest.config.ts"] = renderVitestConfig(normalized, profiles);
  }
  if (shouldManageFeature("hygieneTemplates", normalized, profiles)) {
    Object.assign(files, renderHygieneFiles(normalized));
  }

  return files;
}

export function writeManagedFiles({ repoRoot: targetRoot, server, profiles }) {
  const normalized = normalizeServerConfig(server);
  const files = {
    ...renderManagedFiles(normalized, profiles),
    ...renderTypescriptReleaseMetadataFiles(targetRoot, normalized, profiles),
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
  return files;
}

export function getPolicy() {
  return policy;
}

export function buildManagedBaseline(server, profiles, templateData) {
  const normalized = normalizeServerConfig(server);

  if (normalized.type === "typescript") {
    const managedDependencies = new Set(
      profiles.ci.managedBaseline?.dependencies ?? [],
    );
    const managedDevDependencies = new Set(
      profiles.ci.managedBaseline?.devDependencies ?? [],
    );

    return {
      engines: { node: templateData.engines?.node },
      dependencies: pickDependencySubset(
        templateData.dependencies ?? {},
        managedDependencies,
      ),
      devDependencies: pickDependencySubset(
        templateData.devDependencies ?? {},
        managedDevDependencies,
      ),
    };
  }

  return {
    requiresPython: templateData.requiresPython,
    dependencies: pickRequirementSubset(
      templateData.dependencies ?? [],
      new Set(profiles.ci.managedBaseline?.dependencies ?? []),
    ),
    devDependencies: pickRequirementSubset(
      templateData.devDependencies ?? [],
      new Set(profiles.ci.managedBaseline?.devDependencies ?? []),
    ),
  };
}

function inferCiProfile(type, packageLayout, coverageTargets) {
  if (type === "typescript") {
    return "ts-vitest";
  }
  if (packageLayout === "monorepo") {
    return "py-monorepo";
  }
  if (
    Array.isArray(coverageTargets) &&
    coverageTargets.length > 0 &&
    coverageTargets[0] !== "src"
  ) {
    return "py-flat-layout";
  }
  return "py-src-layout";
}

function inferReleaseProfile(type) {
  return type === "typescript" ? "release-please-manifest" : "pypi-oidc";
}

function inferSecurityProfile(type, packageLayout) {
  if (type === "python" && packageLayout !== "root") {
    return "bandit-root";
  }
  if (type === "python") {
    return "strict";
  }
  return "strict";
}

function inferCoverageTargets(server, packagePath) {
  if (server.type === "typescript") {
    return [];
  }
  if (server.packageLayout === "monorepo") {
    return [];
  }
  if (packagePath === "." || packagePath === "") {
    return ["."];
  }
  const sanitized = packagePath.replace(/^\.?\//, "");
  return [`${sanitized}/src`];
}

function defaultDependabotEcosystems(server) {
  if (server.type === "typescript") {
    return [
      { packageEcosystem: "npm", directory: "/" },
      { packageEcosystem: "github-actions", directory: "/" },
    ];
  }

  const packageDirectory =
    server.packagePath && server.packagePath !== "."
      ? `/${server.packagePath.replace(/^\.?\//, "")}`
      : "/";

  return [
    { packageEcosystem: "pip", directory: packageDirectory },
    { packageEcosystem: "github-actions", directory: "/" },
  ];
}

function shouldManageFeature(feature, server, profiles) {
  if (server.allowOverrides.includes(feature)) {
    return false;
  }

  const availableFeatures = new Set(profiles.tierFeatures);
  profiles.ci.managedFeatures?.forEach((value) => availableFeatures.add(value));
  profiles.release.managedFeatures?.forEach((value) =>
    availableFeatures.add(value),
  );
  profiles.security.managedFeatures?.forEach((value) =>
    availableFeatures.add(value),
  );

  return availableFeatures.has(feature);
}

function renderStaticWorkflowTemplate(serverType, workflowName) {
  const templatePath = path.join(
    repoRoot,
    "templates",
    serverType,
    ".github",
    "workflows",
    workflowName,
  );
  return fs.readFileSync(templatePath, "utf8");
}

const HYGIENE_FILES = [
  ".github/CODEOWNERS",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
];

function renderHygieneFiles(server) {
  const githubUrl = server.github ?? `https://github.com/verygoodplugins/${server.name}`;
  const repoSlug = githubUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  const files = {};
  for (const relativePath of HYGIENE_FILES) {
    const templatePath = path.join(
      repoRoot,
      "templates",
      server.type,
      relativePath,
    );
    const raw = fs.readFileSync(templatePath, "utf8");
    files[relativePath] = raw
      .replace(/\{repo_slug\}/g, repoSlug)
      .replace(/\{name\}/g, server.name);
  }
  return files;
}

function renderCiWorkflow(server, profiles) {
  if (server.type === "typescript") {
    return renderTypescriptCiWorkflow(server, profiles.ci);
  }
  return renderPythonCiWorkflow(server, profiles.ci);
}

function renderTypescriptCiWorkflow(server, ciProfile) {
  const nodeVersion = normalizeNodeVersions(ciProfile)[0];
  const coverageStep = ciProfile.coverageCommand
    ? `
      - name: Test coverage
        run: ${ciProfile.coverageCommand}`
    : "";
  const integrationJob = renderTypescriptIntegrationJob(server, ciProfile);

  return `name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  merge_group:

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "${nodeVersion}"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: ${ciProfile.testCommand}${coverageStep}${integrationJob}
`;
}

function renderTypescriptIntegrationJob(server, ciProfile) {
  if (!ciProfile.integrationTestCommand) {
    return "";
  }

  const runWhen = ciProfile.integrationTestWhen ?? "push-main";
  if (runWhen !== "push-main") {
    throw new Error(`Unsupported integration test schedule: ${runWhen}`);
  }

  const env = renderWorkflowEnv(server.integrationTestSecrets ?? []);
  const continueOnError = ciProfile.integrationContinueOnError ? "true" : "false";

  return `

  integration:
    name: Integration${ciProfile.integrationContinueOnError ? " (non-blocking)" : ""}
    needs: test
    if: \${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    continue-on-error: ${continueOnError}
    runs-on: ubuntu-latest${env}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "${normalizeNodeVersions(ciProfile)[0]}"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Integration tests
        run: ${ciProfile.integrationTestCommand}
`;
}

function normalizeNodeVersions(ciProfile) {
  if (Array.isArray(ciProfile.nodeVersions) && ciProfile.nodeVersions.length) {
    return ciProfile.nodeVersions.map(String);
  }
  if (ciProfile.nodeVersion) {
    return [String(ciProfile.nodeVersion)];
  }
  return ["24"];
}

function renderPythonCiWorkflow(server, ciProfile) {
  if (ciProfile.supportsGoBridge) {
    return renderPythonGoMonorepoCiWorkflow(server);
  }

  const defaultsBlock =
    server.packagePath && server.packagePath !== "."
      ? `
defaults:
  run:
    working-directory: ${server.packagePath}
`
      : "";
  const coverageArgs = buildPythonCoverageArgs(server);
  const coverageFile =
    server.packagePath && server.packagePath !== "."
      ? `${server.packagePath}/coverage.xml`
      : "coverage.xml";

  return `name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  merge_group:
  workflow_dispatch:

${defaultsBlock}jobs:
  test:
    name: Python CI
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["${ciProfile.pythonVersions.join('", "')}"]

    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ github.event_name == 'workflow_dispatch' && github.event.inputs.tag || github.sha }}

      - name: Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: \${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"

      - name: Lint with ruff
        run: |
          ruff check .
          ruff format --check .

      - name: Test with pytest
        run: |
          pytest ${coverageArgs} --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@a99c28d3f0da835de33ff2feb2e15691c7b9641f # v7
        with:
          files: ${coverageFile}
        continue-on-error: true
`;
}

function renderSecurityWorkflow(server, profiles) {
  if (server.type === "typescript") {
    return renderTypescriptSecurityWorkflow(server, profiles);
  }
  return renderPythonSecurityWorkflow(server, profiles);
}

function renderTypescriptSecurityWorkflow(server, profiles) {
  const codeqlConfig = server.codeqlConfigPath
    ? `\n          config-file: ./${server.codeqlConfigPath.replace(/^\.\//, "")}`
    : "";
  const continueOnError = profiles.security.dependencyAuditContinueOnError
    ? "true"
    : "false";

  return `name: Security

on:
  schedule:
    - cron: "0 0 * * 0"
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  security-events: write

jobs:
  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - name: Initialize CodeQL
        uses: github/codeql-action/init@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4
        with:
          languages: typescript${codeqlConfig}

      - name: Autobuild
        uses: github/codeql-action/autobuild@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

  audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          cache: "npm"

      - run: npm ci

      - name: Audit dependencies
        run: npm audit --audit-level=high
        continue-on-error: ${continueOnError}
`;
}

function renderPythonSecurityWorkflow(server, profiles) {
  if (profiles.security.supportsGoBridge) {
    return renderPythonGoMonorepoSecurityWorkflow(server, profiles);
  }

  const pipWorkingDirectory =
    server.packagePath && server.packagePath !== "."
      ? `
        working-directory: ${server.packagePath}`
      : "";
  const banditTarget = resolveBanditTarget(server, profiles);
  const pipAuditContinueOnError = profiles.security.pipAuditContinueOnError
    ? "true"
    : "false";
  const banditContinueOnError = profiles.security.banditContinueOnError
    ? "true"
    : "false";

  return `name: Security

on:
  schedule:
    - cron: "0 0 * * 0"
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  security-events: write

jobs:
  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - name: Initialize CodeQL
        uses: github/codeql-action/init@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4
        with:
          languages: python

      - name: Autobuild
        uses: github/codeql-action/autobuild@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

  audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"

      - name: Install pip-audit
        run: pip install pip-audit

      - name: Install package dependencies${pipWorkingDirectory}
        run: pip install -e .

      - name: Audit dependencies${pipWorkingDirectory}
        run: pip-audit
        continue-on-error: ${pipAuditContinueOnError}

  bandit:
    name: Bandit Security Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"

      - name: Install bandit
        run: pip install bandit

      - name: Run bandit
        run: bandit -r ${banditTarget} -ll
        continue-on-error: ${banditContinueOnError}
`;
}

function renderDependabotConfig(server) {
  const updates = (server.dependabot?.ecosystems ?? []).map((ecosystem) =>
    renderDependabotUpdate(server, ecosystem),
  );

  return `version: 2
updates:
${updates.join("\n")}
`;
}

function renderDependabotUpdate(server, ecosystem) {
  const openPullRequestsLimit = ecosystem.packageEcosystem === "pip" ? 2 : 10;
  const lines = [
    `  - package-ecosystem: "${ecosystem.packageEcosystem}"`,
    `    directory: "${ecosystem.directory}"`,
    "    schedule:",
    '      interval: "weekly"',
  ];

  if (ecosystem.packageEcosystem === "npm") {
    lines.push(...renderNpmDependabotGroups());
  }

  lines.push(
    "    commit-message:",
    '      prefix: "chore(deps)"',
    `    open-pull-requests-limit: ${openPullRequestsLimit}`,
  );
  return lines.join("\n");
}

function renderNpmDependabotGroups() {
  return [
    "    groups:",
    "      security-updates:",
    "        applies-to: security-updates",
    "        patterns:",
    '          - "*"',
    "      production-minor-patch:",
    "        applies-to: version-updates",
    '        dependency-type: "production"',
    "        update-types:",
    '          - "minor"',
    '          - "patch"',
    "      eslint-minor-patch:",
    "        applies-to: version-updates",
    '        dependency-type: "development"',
    "        patterns:",
    '          - "@eslint/*"',
    '          - "eslint"',
    '          - "eslint-*"',
    '          - "typescript-eslint"',
    "        update-types:",
    '          - "minor"',
    '          - "patch"',
    "      typescript-minor-patch:",
    "        applies-to: version-updates",
    '        dependency-type: "development"',
    "        patterns:",
    '          - "@types/*"',
    '          - "tsx"',
    '          - "typescript"',
    "        update-types:",
    '          - "minor"',
    '          - "patch"',
    "      test-tooling-minor-patch:",
    "        applies-to: version-updates",
    '        dependency-type: "development"',
    "        patterns:",
    '          - "@jest/*"',
    '          - "@vitest/*"',
    '          - "jest"',
    '          - "jest-*"',
    '          - "ts-jest"',
    '          - "vitest"',
    "        update-types:",
    '          - "minor"',
    '          - "patch"',
    "      development-minor-patch:",
    "        applies-to: version-updates",
    '        dependency-type: "development"',
    "        exclude-patterns:",
    '          - "@eslint/*"',
    '          - "@jest/*"',
    '          - "@types/*"',
    '          - "@vitest/*"',
    '          - "eslint"',
    '          - "eslint-*"',
    '          - "jest"',
    '          - "jest-*"',
    '          - "ts-jest"',
    '          - "tsx"',
    '          - "typescript"',
    '          - "typescript-eslint"',
    '          - "vitest"',
    "        update-types:",
    '          - "minor"',
    '          - "patch"',
  ];
}

function renderReleaseWorkflow(server, profiles) {
  if (server.type === "typescript") {
    return renderTypescriptReleaseWorkflow(server, profiles.release);
  }
  return renderPythonReleaseWorkflow(server, profiles.release);
}

function renderReleaseFiles(server, profiles) {
  const workflowPath =
    profiles.release.workflowFile ?? defaultReleaseWorkflowPath(server.type);
  const files = {
    [workflowPath]: renderReleaseWorkflow(server, profiles),
  };

  for (const extraWorkflowPath of profiles.release.additionalWorkflowFiles ?? []) {
    files[extraWorkflowPath] = renderAdditionalReleaseWorkflow(
      server,
      profiles.release,
      extraWorkflowPath,
    );
  }

  return files;
}

function renderTypescriptReleaseMetadataFiles(targetRoot, server, profiles) {
  if (
    server.type !== "typescript" ||
    profiles.release.mode !== "manifest"
  ) {
    return {};
  }

  const packageRoot = path.join(targetRoot, server.packagePath);
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    return {};
  }

  return {
    "release-please-config.json": renderTypescriptReleasePleaseConfig(),
    ".release-please-manifest.json": `${JSON.stringify(
      { ".": packageJson.version },
      null,
      2,
    )}\n`,
  };
}

function renderTypescriptReleasePleaseConfig() {
  return `{
  "packages": {
    ".": {
      "release-type": "node",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-component-in-tag": false,
      "extra-files": [
        {
          "type": "json",
          "path": "server.json",
          "jsonpath": "$.version"
        },
        {
          "type": "json",
          "path": "server.json",
          "jsonpath": "$.packages[0].version"
        }
      ]
    }
  }
}
`;
}

function renderTypescriptReleaseWorkflow(server, releaseProfile) {
  const releaseConfig =
    releaseProfile.mode === "manifest"
      ? `          manifest-file: ".release-please-manifest.json"
          config-file: "release-please-config.json"`
      : "          release-type: node";
  const docsDispatchJob = renderTypescriptDocsDispatchJob(server);
  const mcpRegistryJob = renderTypescriptMcpRegistryPublishJob(server);
  const extensionJob =
    releaseProfile.supportsDesktopExtension || server.desktopExtension
      ? `

  build-extension:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ needs.release-please.outputs.tag_name }}
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          cache: "npm"

      - run: npm ci
      - run: npm run build:extension

      - name: Upload Extension to Release
        uses: softprops/action-gh-release@c12583777ecdfd3be55c69cf75464299dc01057e # v3
        with:
          tag_name: \${{ needs.release-please.outputs.tag_name }}
          files: "*.mcpb"`
      : "";

  return `name: Release Please

on:
  push:
    branches:
      - main

permissions: {}

jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
      tag_name: \${{ steps.release.outputs.tag_name }}
      sha: \${{ steps.release.outputs.sha }}
    steps:
      - uses: googleapis/release-please-action@0dfd8538845b8e92600d271a895a5372865d4062 # v5
        id: release
        with:
${releaseConfig}
          token: \${{ secrets.RELEASE_PLEASE_TOKEN || github.token }}

  npm-publish:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ needs.release-please.outputs.tag_name }}
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"

      - run: npm install -g npm@11.19.0
      - run: npm ci --ignore-scripts
      - run: npm run build
      - run: npm test
      - run: npm publish --provenance --access public

  gh-packages-publish:
    needs: [release-please, npm-publish]
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    continue-on-error: true
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ needs.release-please.outputs.tag_name }}
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          registry-url: "https://npm.pkg.github.com"
          scope: "@verygoodplugins"

      - run: npm install -g npm@11.19.0
      - run: npm ci --ignore-scripts
      - run: npm run build

      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.GITHUB_TOKEN }}${mcpRegistryJob}${extensionJob}${docsDispatchJob}
`;
}

function renderTypescriptMcpRegistryPublishJob(server) {
  if (!server.mcpRegistry) {
    return "";
  }

  return `

  mcp-registry-publish:
    needs: [release-please, npm-publish]
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ needs.release-please.outputs.tag_name }}
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"

      - name: Install pinned MCP Publisher
        run: |
          set -euo pipefail
          archive="$RUNNER_TEMP/mcp-publisher_linux_amd64.tar.gz"
          install_dir="$(mktemp -d "$RUNNER_TEMP/mcp-publisher.XXXXXX")"
          curl --fail --location --show-error --silent \\
            --output "$archive" \\
            "https://github.com/modelcontextprotocol/registry/releases/download/v1.8.1/mcp-publisher_linux_amd64.tar.gz"
          printf '%s  %s\\n' "a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc" "$archive" | sha256sum --check --strict
          tar -xzf "$archive" -C "$install_dir" mcp-publisher
          chmod +x "$install_dir/mcp-publisher"
          echo "$install_dir" >> "$GITHUB_PATH"

      - name: Publish to MCP Registry
        run: |
          mcp-publisher login github-oidc
          mcp-publisher publish
        env:
          MCP_REGISTRY_URL: https://registry.modelcontextprotocol.io`;
}

function renderTypescriptDocsDispatchJob(server) {
  const docsDispatch = server.docsDispatch;
  if (!docsDispatch) {
    return "";
  }
  if (!docsDispatch.repository) {
    throw new Error(`${server.name} docsDispatch.repository is required`);
  }

  const eventType = docsDispatch.eventType ?? "docs-update";
  const sourceBranch = docsDispatch.sourceBranch ?? "main";
  const fileDocMapUrl = docsDispatch.fileDocMapUrl ?? "";

  return `

  docs-dispatch:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          fetch-depth: 0
          ref: \${{ needs.release-please.outputs.tag_name }}

      - name: Get changed files since last release
        id: changed
        run: |
          CURR_TAG="\${{ needs.release-please.outputs.tag_name }}"
          PREV_TAG=$(git tag --sort=-version:refname | grep -v -xF "$CURR_TAG" | head -1 || true)

          if [ -z "$PREV_TAG" ]; then
            echo "::warning::No previous tag found, diffing against first commit"
            PREV_TAG=$(git rev-list --max-parents=0 HEAD)
          fi

          echo "Diffing $PREV_TAG..$CURR_TAG"
          FILES=$(git diff --name-only "$PREV_TAG" "$CURR_TAG" | jq -R -s -c 'split("\\n") | map(select(. != ""))')

          {
            echo "files=$FILES"
            echo "compare_url=https://github.com/\${{ github.repository }}/compare/$PREV_TAG...$CURR_TAG"
          } >> "$GITHUB_OUTPUT"

      - name: Check file-doc mapping
        id: check
        env:
          CHANGED_FILES: \${{ steps.changed.outputs.files }}
          FILE_DOC_MAP_URL: ${JSON.stringify(fileDocMapUrl)}
          GH_TOKEN: \${{ secrets.RELEASE_PLEASE_TOKEN || github.token }}
        run: |
          if [ -z "$FILE_DOC_MAP_URL" ]; then
            echo "::warning::No file-doc-map URL configured, dispatching anyway"
            echo "affected=unknown" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          curl_args=(-sf --connect-timeout 10 --max-time 30 --retry 2 --retry-connrefused)
          if [ -n "$GH_TOKEN" ]; then
            curl_args+=(-H "Authorization: Bearer $GH_TOKEN")
          fi

          if ! MAP=$(curl "\${curl_args[@]}" "$FILE_DOC_MAP_URL"); then
            echo "::warning::Failed to fetch file-doc-map.json, dispatching anyway"
            echo "affected=unknown" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          AFFECTED=$(echo "$MAP" | jq -r --arg repo "\${{ github.event.repository.name }}" --argjson changed "$CHANGED_FILES" '
            def matches_pattern($file; $pattern):
              if ($pattern | endswith("/**")) then
                ($file | startswith($pattern[0:-2]))
              else
                $file == $pattern
              end;

            .[$repo] // {} | to_entries | map(
              select(.key as $pattern | $changed | any(. as $file | matches_pattern($file; $pattern)))
            ) | map(.value) | flatten | unique | .[]
          ')

          if [ -z "$AFFECTED" ]; then
            echo "No doc pages affected by this release"
            echo "affected=none" >> "$GITHUB_OUTPUT"
          else
            AFFECTED_JSON=$(echo "$AFFECTED" | jq -R -s -c 'split("\\n") | map(select(. != ""))')
            echo "Affected doc pages: $AFFECTED_JSON"
            echo "affected=$AFFECTED_JSON" >> "$GITHUB_OUTPUT"
          fi

      - name: Dispatch docs update
        if: steps.check.outputs.affected != 'none'
        env:
          GH_TOKEN: \${{ secrets.RELEASE_PLEASE_TOKEN || github.token }}
          DOCS_REPOSITORY: ${docsDispatch.repository}
          DOCS_EVENT_TYPE: ${eventType}
          SOURCE_REPO: \${{ github.repository }}
          SOURCE_SHA: \${{ needs.release-please.outputs.sha || needs.release-please.outputs.tag_name }}
          SOURCE_BRANCH: ${sourceBranch}
          TAG_NAME: \${{ needs.release-please.outputs.tag_name }}
          CHANGED_FILES: \${{ steps.changed.outputs.files }}
          AFFECTED_DOCS: \${{ steps.check.outputs.affected }}
          COMPARE_URL: \${{ steps.changed.outputs.compare_url }}
        run: |
          payload=$(jq -n \\
            --arg event_type "$DOCS_EVENT_TYPE" \\
            --arg source_repo "$SOURCE_REPO" \\
            --arg source_sha "$SOURCE_SHA" \\
            --arg source_branch "$SOURCE_BRANCH" \\
            --arg compare_url "$COMPARE_URL" \\
            --arg reason "Release $TAG_NAME" \\
            --arg changed_files "$CHANGED_FILES" \\
            --arg affected_docs "$AFFECTED_DOCS" \\
            '{
              event_type: $event_type,
              client_payload: {
                source_repo: $source_repo,
                source_sha: $source_sha,
                source_branch: $source_branch,
                changed_files: ($changed_files | fromjson),
                affected_docs: (try ($affected_docs | fromjson) catch $affected_docs),
                compare_url: $compare_url,
                reason: $reason
              }
            }')

          echo "$payload" | gh api "repos/$DOCS_REPOSITORY/dispatches" --input -`;
}

function renderPythonReleaseWorkflow(server, releaseProfile) {
  if (releaseProfile.mode === "release-please-manifest-go-artifacts") {
    return renderPythonGoReleasePleaseWorkflow(server);
  }
  if (releaseProfile.mode === "manual-fallback-go") {
    return renderPythonGoManualFallbackRelease(server);
  }

  const buildDirectory =
    server.packagePath && server.packagePath !== "."
      ? `
        working-directory: ${server.packagePath}`
      : "";
  const artifactPath =
    server.packagePath && server.packagePath !== "."
      ? `${server.packagePath}/dist/`
      : "dist/";

  return `name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"

      - name: Install build dependencies${buildDirectory}
        run: |
          python -m pip install --upgrade pip
          pip install build

      - name: Build package${buildDirectory}
        run: python -m build

      - name: Upload artifacts
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: dist
          path: ${artifactPath}

  publish-pypi:
    needs: build
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write
    steps:
      - name: Download artifacts
        uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7
        with:
          name: dist
          path: dist/

      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@dc37677b2e1c63e2034f94d8a5b11f265b73ba33 # release/v1

  create-release:
    needs: publish-pypi
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - name: Create GitHub Release
        uses: softprops/action-gh-release@c12583777ecdfd3be55c69cf75464299dc01057e # v3
        with:
          generate_release_notes: true
`;
}

function renderAdditionalReleaseWorkflow(server, releaseProfile, workflowPath) {
  if (
    releaseProfile.mode === "release-please-manifest-go-artifacts" &&
    workflowPath === ".github/workflows/release.yml"
  ) {
    return renderPythonGoManualFallbackRelease(server);
  }

  if (releaseProfile.mode === "manual-fallback-go") {
    return renderPythonGoManualFallbackRelease(server);
  }

  throw new Error(
    `No additional workflow renderer for ${releaseProfile.id} at ${workflowPath}`,
  );
}

function renderPythonGoReleasePleaseWorkflow(server) {
  const goVersion = server.goVersion ?? "1.25";
  const versionCheckScript =
    server.versionCheckScript ?? ".github/scripts/check_versions.py";
  const goArtifactName = path.basename(server.goPackagePath ?? "go-bridge");

  return `name: Release Please

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  release-please:
    name: Release Please
    runs-on: ubuntu-latest
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
      tag_name: \${{ steps.release.outputs.tag_name }}
      sha: \${{ steps.release.outputs.sha }}
    steps:
      - uses: googleapis/release-please-action@0dfd8538845b8e92600d271a895a5372865d4062 # v5
        id: release
        with:
          token: \${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish-release-assets:
    name: Publish Release Artifacts
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ needs.release-please.outputs.sha }}

      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"

      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"

      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7

      - name: Validate version consistency
        run: python ${versionCheckScript} --tag "\${{ needs.release-please.outputs.tag_name }}"

      - name: Build release artifacts
        run: |
          mkdir -p dist

          cd ${server.goPackagePath}
          GOOS=linux GOARCH=amd64 go build -o ../dist/${goArtifactName}-linux-amd64 .
          cd ..

          cd ${server.packagePath}
          uv build --out-dir ../dist
          cd ..

          cd dist
          sha256sum * > SHA256SUMS.txt

      - name: Upload release artifacts
        uses: softprops/action-gh-release@c12583777ecdfd3be55c69cf75464299dc01057e # v3
        with:
          tag_name: \${{ needs.release-please.outputs.tag_name }}
          files: dist/*
          fail_on_unmatched_files: true
          overwrite_files: true
`;
}

function renderPythonGoMonorepoCiWorkflow(server) {
  const goVersion = server.goVersion ?? "1.25";
  const goPath = server.goPackagePath;
  const versionCheckScript =
    server.versionCheckScript ?? ".github/scripts/check_versions.py";

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  merge_group:
  workflow_dispatch:

jobs:
  version-consistency:
    name: Version Consistency
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"
      - name: Validate project versions are in sync
        run: python ${versionCheckScript}

  python-lint:
    name: Python Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7
      - name: Install dependencies
        run: |
          cd ${server.packagePath}
          uv venv
          uv pip install ruff
      - name: Run ruff check
        run: |
          cd ${server.packagePath}
          uv run ruff check .
      - name: Run ruff format check
        run: |
          cd ${server.packagePath}
          uv run ruff format --check .

  go-lint:
    name: Go Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - name: golangci-lint
        uses: golangci/golangci-lint-action@9fae48acfc02a90574d7c304a1758ef9895495fa # v7
        with:
          version: v2.7.1
          working-directory: ${goPath}

  go-build:
    name: Go Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - name: Build
        run: |
          cd ${goPath}
          go build -v ./...

  python-test:
    name: Python Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7
      - name: Install dependencies
        run: |
          cd ${server.packagePath}
          uv venv
          uv pip install -e ".[dev]"
      - name: Run tests
        run: |
          cd ${server.packagePath}
          uv run pytest -v
`;
}

function renderPythonGoMonorepoSecurityWorkflow(server, profiles) {
  const goVersion = server.goVersion ?? "1.25";
  const banditTarget = resolveBanditTarget(server, profiles);

  return `name: Security

on:
  schedule:
    - cron: "0 0 * * 0"
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  security-events: write

jobs:
  codeql-python:
    name: CodeQL Analysis (Python)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - name: Initialize CodeQL
        uses: github/codeql-action/init@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4
        with:
          languages: python

      - name: Autobuild
        uses: github/codeql-action/autobuild@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

  codeql-go:
    name: CodeQL Analysis (Go)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - name: Initialize CodeQL
        uses: github/codeql-action/init@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4
        with:
          languages: go
      - name: Autobuild
        uses: github/codeql-action/autobuild@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@988661ebb5e81487b3fb31b2185d2856c0a10679 # v4

  python-audit:
    name: Python Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"
      - name: Install pip-audit
        run: pip install pip-audit
      - name: Install package dependencies
        run: |
          cd ${server.packagePath}
          pip install -e .
      - name: Audit dependencies
        run: |
          cd ${server.packagePath}
          pip-audit
        continue-on-error: ${profiles.security.pipAuditContinueOnError ? "true" : "false"}

  bandit:
    name: Bandit Security Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"
      - name: Install bandit
        run: pip install bandit
      - name: Run bandit
        run: bandit -r ${banditTarget} -ll
        continue-on-error: ${profiles.security.banditContinueOnError ? "true" : "false"}

  govulncheck:
    name: Go Vulnerability Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - name: Install govulncheck
        run: go install golang.org/x/vuln/cmd/govulncheck@latest
      - name: Run govulncheck
        run: |
          cd ${server.goPackagePath}
          govulncheck ./...
        continue-on-error: true
`;
}

function renderPythonGoManualFallbackRelease(server) {
  const goVersion = server.goVersion ?? "1.25";
  const versionCheckScript =
    server.versionCheckScript ?? ".github/scripts/check_versions.py";
  const goArtifactName = path.basename(server.goPackagePath ?? "go-bridge");

  return `name: Release (Manual Fallback)

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Release tag to validate and publish artifacts for (vMAJOR.MINOR.PATCH)"
        required: true
        type: string

permissions:
  contents: write

jobs:
  validate-release:
    name: Validate Release Inputs
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ github.event.inputs.tag }}
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7
        with:
          python-version: "3.11"
      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7
      - name: Validate version consistency
        run: |
          python ${versionCheckScript} --tag "\${{ github.event.inputs.tag }}"
      - name: Verify golangci configuration
        run: |
          cd ${server.goPackagePath}
          go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.7.1 config verify
      - name: Run Go lint
        uses: golangci/golangci-lint-action@9fae48acfc02a90574d7c304a1758ef9895495fa # v7
        with:
          version: v2.7.1
          working-directory: ${server.goPackagePath}
      - name: Run Go tests
        run: |
          cd ${server.goPackagePath}
          go test ./...
      - name: Build Go bridge
        run: |
          cd ${server.goPackagePath}
          go build -v ./...
      - name: Run Python tests
        run: |
          cd ${server.packagePath}
          uv sync --extra dev
          uv run pytest -q

  publish-github-release:
    name: Publish GitHub Release
    needs: validate-release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ github.event.inputs.tag }}
      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7
        with:
          go-version: "${goVersion}"
      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7
      - name: Build release artifacts
        run: |
          mkdir -p dist
          cd ${server.goPackagePath}
          GOOS=linux GOARCH=amd64 go build -o ../dist/${goArtifactName}-linux-amd64 .
          cd ..
          cd ${server.packagePath}
          uv build --out-dir ../dist
          cd ..
          cd dist
          sha256sum * > SHA256SUMS.txt
      - name: Create GitHub release
        uses: softprops/action-gh-release@c12583777ecdfd3be55c69cf75464299dc01057e # v3
        with:
          tag_name: \${{ github.event.inputs.tag }}
          files: dist/*
          generate_release_notes: true
          overwrite_files: true
`;
}

function renderWorkflowEnv(secretNames) {
  if (secretNames.length === 0) {
    return "";
  }

  const envLines = secretNames
    .map(
      (secretName) => `      ${secretName}: \${{ secrets.${secretName} }}`,
    )
    .join("\n");

  return `
    env:
${envLines}`;
}

function pickDependencySubset(dependencies, managedNames) {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([packageName]) =>
      managedNames.has(packageName),
    ),
  );
}

function pickRequirementSubset(entries, managedNames) {
  if (managedNames.size === 0) {
    return [];
  }

  return entries.filter((entry) =>
    managedNames.has(extractRequirementName(entry)),
  );
}

function extractRequirementName(entry) {
  return entry.split(/[<>=!~\s\[]/, 1)[0];
}

function renderTypescriptEslintConfig() {
  return `import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
`;
}

function renderVitestConfig(server, profiles) {
  const coverageExcludes =
    profiles.ci.integrationTestCommand
      ? `['node_modules/', 'dist/', 'tests/', 'tests/integration/**', '*.config.*']`
      : `['node_modules/', 'dist/', 'tests/', '*.config.*']`;

  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ${coverageExcludes},
    },
  },
});
`;
}

function buildPythonCoverageArgs(server) {
  const targets = server.coverageTargets ?? [];
  if (targets.length === 0) {
    return "--cov=.";
  }

  return targets.map((target) => `--cov=${target}`).join(" ");
}

function resolveBanditTarget(server, profiles) {
  if (server.banditTarget) {
    return server.banditTarget;
  }

  const mode =
    profiles.security.banditTargetMode ?? profiles.ci.banditTargetMode ?? "src";
  if (mode === "root") {
    return ".";
  }
  if (server.packagePath && server.packagePath !== ".") {
    return `${server.packagePath}/src/`;
  }
  return "src/";
}

function defaultReleaseWorkflowPath(type) {
  return type === "typescript"
    ? ".github/workflows/release-please.yml"
    : ".github/workflows/release.yml";
}
