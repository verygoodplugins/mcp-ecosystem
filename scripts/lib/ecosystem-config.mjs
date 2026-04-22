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
    profiles.ci.id === "ts-vitest" &&
    shouldManageFeature("vitestConfig", normalized, profiles)
  ) {
    files["vitest.config.ts"] = renderVitestConfig(normalized, profiles);
  }

  return files;
}

export function writeManagedFiles({ repoRoot: targetRoot, server, profiles }) {
  const files = renderManagedFiles(server, profiles);
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
      profiles.ci.managedBaseline?.dependencies ?? [
        "@modelcontextprotocol/sdk",
      ],
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

function renderCiWorkflow(server, profiles) {
  if (server.type === "typescript") {
    return renderTypescriptCiWorkflow(server, profiles.ci);
  }
  return renderPythonCiWorkflow(server, profiles.ci);
}

function renderTypescriptCiWorkflow(server, ciProfile) {
  const coverageStep = ciProfile.coverageCommand
    ? `
      - name: Test coverage
        run: ${ciProfile.coverageCommand}`
    : "";
  const integrationEnv = renderWorkflowEnv(server.integrationTestSecrets ?? []);
  const integrationStep = ciProfile.integrationTestCommand
    ? `

      - name: Integration tests
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'${integrationEnv}
        run: ${ciProfile.integrationTestCommand}`
    : "";

  return `name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "${ciProfile.nodeVersion}"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: ${ciProfile.testCommand}${coverageStep}${integrationStep}
`;
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
  workflow_dispatch:

${defaultsBlock}jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["${ciProfile.pythonVersions.join('", "')}"]

    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.tag }}
        with:
          ref: \${{ github.event.inputs.tag }}

      - name: Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@v5
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
        uses: codecov/codecov-action@v4
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
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: typescript${codeqlConfig}

      - name: Autobuild
        uses: github/codeql-action/autobuild@v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4

  audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
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
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: python

      - name: Autobuild
        uses: github/codeql-action/autobuild@v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4

  audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
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
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
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
  const lines = [
    `  - package-ecosystem: "${ecosystem.packageEcosystem}"`,
    `    directory: "${ecosystem.directory}"`,
    "    schedule:",
    '      interval: "weekly"',
  ];

  if (ecosystem.packageEcosystem === "npm") {
    lines.push(
      "    groups:",
      "      runtime-dependencies:",
      '        dependency-type: "production"',
      "      toolchain:",
      '        dependency-type: "development"',
    );
  } else if (ecosystem.packageEcosystem === "pip") {
    lines.push(
      "    groups:",
      "      runtime-dependencies:",
      '        dependency-type: "production"',
      "      dev-dependencies:",
      '        dependency-type: "development"',
    );
  }

  lines.push(
    "    commit-message:",
    '      prefix: "chore(deps)"',
    "    open-pull-requests-limit: 10",
  );
  return lines.join("\n");
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

function renderTypescriptReleaseWorkflow(server, releaseProfile) {
  const releaseConfig =
    releaseProfile.mode === "manifest"
      ? `          manifest-file: ".release-please-manifest.json"
          config-file: "release-please-config.json"`
      : "          release-type: node";
  const extensionJob =
    releaseProfile.supportsDesktopExtension || server.desktopExtension
      ? `

  build-extension:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npm run build:extension

      - name: Upload Extension to Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ needs.release-please.outputs.tag_name }}
          files: "*.mcpb"`
      : "";

  return `name: Release Please

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
      tag_name: \${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
${releaseConfig}
          token: \${{ secrets.RELEASE_PLEASE_TOKEN || github.token }}

  npm-publish:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"

      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --provenance --access public${extensionJob}
`;
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
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install build dependencies${buildDirectory}
        run: |
          python -m pip install --upgrade pip
          pip install build

      - name: Build package${buildDirectory}
        run: python -m build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
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
        uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/

      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@release/v1

  create-release:
    needs: publish-pypi
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
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
      - uses: googleapis/release-please-action@v4
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
      - uses: actions/checkout@v4
        with:
          ref: \${{ needs.release-please.outputs.sha }}

      - uses: actions/setup-go@v5
        with:
          go-version: "${goVersion}"

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - uses: astral-sh/setup-uv@v7

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
        uses: softprops/action-gh-release@v3
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
  workflow_dispatch:

jobs:
  version-consistency:
    name: Version Consistency
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Validate project versions are in sync
        run: python ${versionCheckScript}

  python-lint:
    name: Python Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v7
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
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "${goVersion}"
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v8
        with:
          version: v2.7.1
          working-directory: ${goPath}

  go-build:
    name: Go Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
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
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v7
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
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: python

      - name: Autobuild
        uses: github/codeql-action/autobuild@v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4

  codeql-go:
    name: CodeQL Analysis (Go)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "${goVersion}"
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: go
      - name: Autobuild
        uses: github/codeql-action/autobuild@v4
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4

  python-audit:
    name: Python Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
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
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
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
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
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
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.tag }}
      - uses: actions/setup-go@v5
        with:
          go-version: "${goVersion}"
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - uses: astral-sh/setup-uv@v7
      - name: Validate version consistency
        run: |
          python ${versionCheckScript} --tag "\${{ github.event.inputs.tag }}"
      - name: Verify golangci configuration
        run: |
          cd ${server.goPackagePath}
          go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.7.1 config verify
      - name: Run Go lint
        uses: golangci/golangci-lint-action@v8
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
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.tag }}
      - uses: actions/setup-go@v5
        with:
          go-version: "${goVersion}"
      - uses: astral-sh/setup-uv@v7
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
        uses: softprops/action-gh-release@v3
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
      (secretName) => `          ${secretName}: \${{ secrets.${secretName} }}`,
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
    profiles.ci.id === "ts-vitest"
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
