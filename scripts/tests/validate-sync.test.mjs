import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateRepositorySync } from "../lib/validate-sync.mjs";

function makeTempRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ecosystem-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
  return root;
}

test("fails preflight when Vitest integration profile is missing coverage script", () => {
  const repoRoot = makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-example",
      scripts: {
        lint: "eslint src/",
        build: "tsc",
        test: "vitest run",
        "test:integration": "vitest run tests/integration",
      },
    }),
    "package-lock.json": JSON.stringify({
      name: "@verygoodplugins/mcp-example",
      lockfileVersion: 3,
    }),
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
      name: "mcp-example",
      type: "typescript",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "ts-vitest-integration-nonblocking",
      releaseProfile: "release-please-manifest",
      securityProfile: "strict",
      templateTier: "strict",
      propagate: true,
    },
    profiles: {
      ci: {
        id: "ts-vitest-integration-nonblocking",
        requiredScripts: [
          "lint",
          "build",
          "test",
          "test:coverage",
          "test:integration",
        ],
      },
      release: {
        id: "release-please-manifest",
        requiredFiles: [
          "release-please-config.json",
          ".release-please-manifest.json",
        ],
      },
    },
    syncReport: {
      packageManifestChanged: false,
      lockfileRefreshRequired: false,
      issues: [],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "missing-script",
      "missing-package-allowlist",
      "missing-package-bin",
      "missing-release-file",
      "missing-release-file",
    ],
  );
});

test("fails preflight when semantic sync requires lockfile refresh", () => {
  const repoRoot = makeTempRepo({
    "pyproject.toml": '[project]\nname = "demo"\nversion = "0.1.0"\n',
    "uv.lock": "version = 1\n",
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
      name: "demo",
      type: "python",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "py-flat-layout",
      releaseProfile: "pypi-oidc",
      securityProfile: "strict",
      templateTier: "compatible",
      propagate: true,
    },
    profiles: {
      ci: { id: "py-flat-layout", requiredFiles: ["pyproject.toml"] },
      release: { id: "pypi-oidc", requiredFiles: [] },
    },
    syncReport: {
      packageManifestChanged: true,
      lockfileRefreshRequired: true,
      issues: [
        {
          code: "uv-lock-refresh-required",
          severity: "error",
          message: "uv.lock is stale",
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.at(-1)?.code, "uv-lock-refresh-required");
});

test("fails preflight when repo capabilities are not supported by selected profiles", () => {
  const repoRoot = makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-edd",
      scripts: {
        lint: "eslint src/",
        build: "tsc",
        test: "npm test",
        "test:integration": "npm run test:integration",
      },
    }),
    "package-lock.json": JSON.stringify({
      name: "@verygoodplugins/mcp-edd",
      lockfileVersion: 3,
    }),
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
      name: "mcp-edd",
      type: "typescript",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "ts-jest",
      releaseProfile: "release-please-manifest",
      securityProfile: "strict",
      templateTier: "compatible",
      propagate: true,
      desktopExtension: true,
      integrationTestSecrets: ["EDD_API_URL"],
    },
    profiles: {
      ci: { id: "ts-jest", requiredScripts: ["lint", "build", "test"] },
      release: {
        id: "release-please-manifest",
        requiredFiles: [],
        supportsDesktopExtension: false,
      },
      security: { id: "strict", supportsGoBridge: false },
    },
    syncReport: {
      packageManifestChanged: false,
      lockfileRefreshRequired: false,
      issues: [],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "missing-package-allowlist",
      "missing-package-bin",
      "unsupported-desktop-extension-release",
      "unsupported-integration-test-profile",
    ],
  );
});

test("fails preflight when desktop extension release lacks build script", () => {
  const repoRoot = makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-edd",
      scripts: {
        lint: "eslint src/",
        build: "tsc",
        test: "npm test",
        "test:integration": "npm run test:integration",
      },
    }),
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
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
      integrationTestSecrets: ["EDD_API_URL"],
    },
    profiles: {
      ci: {
        id: "ts-jest-integration",
        requiredScripts: ["lint", "build", "test", "test:integration"],
        integrationTestCommand: "npm run test:integration",
      },
      release: {
        id: "release-please-manifest-extension",
        requiredFiles: [],
        supportsDesktopExtension: true,
      },
      security: { id: "strict", supportsGoBridge: false },
    },
    syncReport: {
      packageManifestChanged: false,
      lockfileRefreshRequired: false,
      issues: [],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "missing-package-allowlist",
      "missing-package-bin",
      "missing-extension-build-script",
    ],
  );
});

test("rejects package content and executable targets outside the approved dist allowlist", () => {
  const repoRoot = makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-example",
      version: "1.0.0",
      files: ["dist/", "src/"],
      bin: { "mcp-example": "src/index.ts" },
      scripts: { lint: "eslint .", build: "tsc", test: "vitest run" },
    }),
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
      name: "mcp-example",
      type: "typescript",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "ts-jest",
      releaseProfile: "release-please-simple",
      securityProfile: "strict",
      templateTier: "compatible",
      propagate: true,
    },
    profiles: {
      ci: { id: "ts-jest", requiredScripts: ["lint", "build", "test"] },
      release: { id: "release-please-simple", requiredFiles: [] },
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["unapproved-package-file", "unsafe-package-bin-target"],
  );
});

test("allows only inventory-declared package-file extras without weakening bin safety", () => {
  const repoRoot = makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-evernote",
      version: "1.0.0",
      files: ["dist", "scripts", "server.json", "MIGRATION.md"],
      bin: { "mcp-evernote": "src/index.ts" },
      scripts: { lint: "eslint .", build: "tsc", test: "jest" },
    }),
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
      name: "mcp-evernote",
      type: "typescript",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "ts-jest",
      releaseProfile: "release-please-simple",
      securityProfile: "strict",
      templateTier: "compatible",
      propagate: true,
      allowedPackageFiles: ["scripts", "server.json", "MIGRATION.md"],
    },
    profiles: {
      ci: { id: "ts-jest", requiredScripts: ["lint", "build", "test"] },
      release: { id: "release-please-simple", requiredFiles: [] },
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["unsafe-package-bin-target"],
  );
});

function validateBinFixture(repoRoot) {
  return validateRepositorySync({
    repoRoot,
    server: {
      name: "mcp-example",
      type: "typescript",
      packageLayout: "root",
      packagePath: ".",
      ciProfile: "ts-jest",
      releaseProfile: "release-please-simple",
      securityProfile: "strict",
      templateTier: "compatible",
      propagate: true,
    },
    profiles: {
      ci: { id: "ts-jest", requiredScripts: ["lint", "build", "test"] },
      release: { id: "release-please-simple", requiredFiles: [] },
    },
  });
}

function makeBinRepo() {
  return makeTempRepo({
    "package.json": JSON.stringify({
      name: "@verygoodplugins/mcp-example",
      version: "1.0.0",
      files: ["dist"],
      bin: { "mcp-example": "dist/cli.js" },
      scripts: { lint: "eslint .", build: "tsc", test: "jest" },
    }),
  });
}

test("rejects a package bin target that is an executable directory", () => {
  const repoRoot = makeBinRepo();
  fs.mkdirSync(path.join(repoRoot, "dist", "cli.js"), { recursive: true });
  fs.chmodSync(path.join(repoRoot, "dist", "cli.js"), 0o755);

  const result = validateBinFixture(repoRoot);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["invalid-package-bin-target"],
  );
});

for (const symlinkTarget of ["real.js", "../../outside.js", "missing.js"]) {
  test(`rejects a package bin symlink to ${symlinkTarget}`, () => {
    const repoRoot = makeBinRepo();
    fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "dist", "real.js"),
      "#!/usr/bin/env node\n",
    );
    fs.chmodSync(path.join(repoRoot, "dist", "real.js"), 0o755);
    fs.writeFileSync(
      path.join(path.dirname(repoRoot), "outside.js"),
      "#!/usr/bin/env node\n",
    );
    fs.chmodSync(path.join(path.dirname(repoRoot), "outside.js"), 0o755);
    fs.symlinkSync(symlinkTarget, path.join(repoRoot, "dist", "cli.js"));

    const result = validateBinFixture(repoRoot);

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["invalid-package-bin-target"],
    );
  });
}

test("fails preflight when go hybrid repo is missing bridge path or version script", () => {
  const repoRoot = makeTempRepo({
    "whatsapp-mcp-server/pyproject.toml":
      '[project]\nname = "whatsapp-mcp-server"\nversion = "0.2.0"\n',
  });

  const result = validateRepositorySync({
    repoRoot,
    server: {
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
      versionCheckScript: ".github/scripts/check_versions.py",
    },
    profiles: {
      ci: {
        id: "py-monorepo-go",
        requiredFiles: ["pyproject.toml"],
        supportsGoBridge: true,
      },
      release: {
        id: "release-please-manifest-go-artifacts",
        requiredFiles: [],
        supportsGoBridgeArtifacts: true,
      },
      security: {
        id: "bandit-root-go",
        supportsGoBridge: true,
      },
    },
    syncReport: {
      packageManifestChanged: false,
      lockfileRefreshRequired: false,
      issues: [],
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["missing-go-package-path", "missing-version-check-script"],
  );
});
