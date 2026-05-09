import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve(
  "scripts/lib/print-apply-templates-followups.mjs",
);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mcp-followups-"));
}

function runFollowups(root, type = "typescript") {
  return execFileSync(process.execPath, [script, root, type], {
    encoding: "utf8",
  });
}

test("apply-template followups pass for a complete TypeScript manifest set", () => {
  const root = makeTempDir();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        mcpName: "io.github.verygoodplugins/mcp-example",
        publishConfig: { access: "public" },
        files: ["dist"],
        scripts: { test: "vitest run" },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, "server.json"),
    JSON.stringify(
      {
        $schema:
          "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      },
      null,
      2,
    ),
  );

  const output = runFollowups(root);

  assert.match(output, /Manifest checks passed/);
  assert.doesNotMatch(output, /Files that may need manual updates/);
});

test("apply-template followups report missing TypeScript registry metadata", () => {
  const root = makeTempDir();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: {} }, null, 2),
  );

  const output = runFollowups(root);

  assert.match(output, /package\.json: Add 'mcpName' field/);
  assert.match(output, /package\.json: Ensure 'publishConfig\.access' is 'public'/);
  assert.match(output, /Create server\.json for MCP Registry/);
});

test("apply-template followups report missing Python metadata", () => {
  const root = makeTempDir();
  fs.writeFileSync(
    path.join(root, "pyproject.toml"),
    "[project]\nname = \"mcp-example\"\n",
  );

  const output = runFollowups(root, "python");

  assert.match(output, /pyproject\.toml: Add \[tool\.mcp\] section/);
  assert.match(output, /pyproject\.toml: Add \[tool\.ruff\] configuration/);
  assert.match(output, /Create server\.json for MCP Registry/);
});
