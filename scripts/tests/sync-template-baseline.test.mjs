import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  attemptLockfileRefresh,
  parseTomlText,
  syncPythonBaseline,
  syncTypescriptBaseline,
} from "../lib/sync-template-baseline-core.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ecosystem-sync-"));
}

test("typescript baseline sync adds missing managed dev dependencies", () => {
  const repoRoot = makeTempDir();
  const templatePackageJson = {
    engines: { node: ">=20.0.0" },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.29.0",
    },
    devDependencies: {
      "@eslint/js": "^9.24.0",
      "eslint-config-prettier": "^10.1.0",
      "typescript-eslint": "^8.30.1",
    },
  };

  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "@verygoodplugins/mcp-example",
        engines: { node: ">=18.0.0" },
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.25.1",
          zod: "^4.0.0",
        },
        devDependencies: {
          "@eslint/js": "^9.39.0",
          eslint: "^9.0.0",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(repoRoot, "package-lock.json"),
    JSON.stringify(
      { name: "@verygoodplugins/mcp-example", lockfileVersion: 3 },
      null,
      2,
    ),
  );

  const report = syncTypescriptBaseline({
    templatePackageJson,
    targetPath: path.join(repoRoot, "package.json"),
  });

  const updated = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );

  assert.equal(updated.engines.node, ">=20.0.0");
  assert.equal(updated.devDependencies["@eslint/js"], "^9.39.0");
  assert.equal(updated.devDependencies["typescript-eslint"], "^8.30.1");
  assert.equal(updated.dependencies.zod, "^4.0.0");
  assert.equal(report.lockfileRefreshRequired, true);
});

test("typescript baseline sync does not lower a stricter engines.node floor", () => {
  const repoRoot = makeTempDir();

  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "@verygoodplugins/mcp-example",
        engines: { node: ">=22.0.0" },
      },
      null,
      2,
    ),
  );

  const report = syncTypescriptBaseline({
    templatePackageJson: {
      engines: { node: ">=20.0.0" },
      dependencies: {},
      devDependencies: {},
    },
    targetPath: path.join(repoRoot, "package.json"),
  });

  const updated = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );

  assert.equal(updated.engines.node, ">=22.0.0");
  assert.equal(report.changed, false);
});

test("python baseline sync updates managed dependencies via parsed toml", () => {
  const repoRoot = makeTempDir();
  const targetPath = path.join(repoRoot, "pyproject.toml");

  fs.writeFileSync(
    targetPath,
    `[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "mcp>=0.9.0",
    "httpx>=0.27.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=9.0.3",
    "ruff>=0.15.11",
]
`,
  );
  fs.writeFileSync(path.join(repoRoot, "uv.lock"), "version = 1\n");

  const report = syncPythonBaseline({
    templateProject: {
      requiresPython: ">=3.11",
      dependencies: [],
      devDependencies: ["pytest>=8.0.0", "ruff>=0.1.0"],
    },
    targetPath,
  });

  const updated = fs.readFileSync(targetPath, "utf8");

  assert.match(updated, /requires-python = ">=3.11"/);
  assert.match(updated, /"pytest>=9.0.3"/);
  assert.match(updated, /"mcp>=0.9.0"/);
  assert.match(updated, /"httpx>=0.27.0"/);
  assert.match(updated, /"ruff>=0.15.11"/);
  assert.equal(report.lockfileRefreshRequired, true);
});

test("python baseline sync does not lower a stricter requires-python floor", () => {
  const repoRoot = makeTempDir();
  const targetPath = path.join(repoRoot, "pyproject.toml");

  fs.writeFileSync(
    targetPath,
    `[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[project.optional-dependencies]
dev = []
`,
  );

  const report = syncPythonBaseline({
    templateProject: {
      requiresPython: ">=3.11",
      dependencies: [],
      devDependencies: [],
    },
    targetPath,
  });

  const updated = fs.readFileSync(targetPath, "utf8");

  assert.match(updated, /requires-python = ">=3.12"/);
  assert.equal(report.changed, false);
});

test("lockfile refresh clears pending refresh requirement after successful command", () => {
  const repoRoot = makeTempDir();
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      { name: "@verygoodplugins/mcp-example", version: "1.0.0" },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(repoRoot, "package-lock.json"),
    JSON.stringify(
      { name: "@verygoodplugins/mcp-example", lockfileVersion: 3 },
      null,
      2,
    ),
  );

  const report = attemptLockfileRefresh({
    serverType: "typescript",
    targetRoot: repoRoot,
    report: {
      changed: true,
      packageManifestChanged: true,
      lockfileRefreshRequired: true,
      changes: [],
      issues: [],
    },
    runner: () => ({ status: 0, stdout: "", stderr: "" }),
  });

  assert.equal(report.lockfileRefreshRequired, false);
  assert.equal(report.issues.length, 0);
});

test("template toml with placeholders can still be parsed", () => {
  const parsed = parseTomlText(`
[project]
name = "mcp-{name}"
description = "{description}"

[project.scripts]
mcp-{name} = "mcp_{name_underscore}.server:main"
`);

  assert.equal(parsed.project.name, "mcp-placeholder");
  assert.equal(parsed.project.description, "placeholder-description");
  assert.equal(
    parsed.project.scripts["mcp-placeholder"],
    "mcp_placeholder_name_underscore.server:main",
  );
});
