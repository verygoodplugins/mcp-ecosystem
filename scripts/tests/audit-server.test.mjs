import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const auditScript = path.resolve("scripts/audit-server.sh");

function findBash5() {
  const candidates = [
    process.env.BASH_5_BIN,
    "/opt/homebrew/bin/bash",
    "/usr/local/bin/bash",
    "bash",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    const match = `${version.stdout}${version.stderr}`.match(
      /GNU bash, version (\d+)\./,
    );
    if (version.status === 0 && Number(match?.[1]) >= 5) {
      return candidate;
    }
  }

  return undefined;
}

test("Bash 5 audit prints its summary after recording errors and warnings", (t) => {
  const bash5 = findBash5();
  if (!bash5) {
    t.skip("Bash 5+ is unavailable");
    return;
  }

  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-"));
  fs.writeFileSync(path.join(serverRoot, "package.json"), "{}\n");

  const result = spawnSync(bash5, [auditScript, serverRoot], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /📊 Audit Summary/);
  assert.match(result.stdout, /❌ Errors:\s+\d*[1-9]\d*/);
  assert.match(result.stdout, /⚠️  Warnings:\s+\d*[1-9]\d*/);
});

test("audit accepts inventory-declared package files as exact extras", (t) => {
  if (spawnSync("jq", ["--version"], { encoding: "utf8" }).status !== 0) {
    t.skip("jq is unavailable");
    return;
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-"));
  const serverRoot = path.join(fixtureRoot, "mcp-evernote");
  const toolRoot = path.join(fixtureRoot, "bin");
  const jqPath = spawnSync("which", ["jq"], { encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(toolRoot);
  fs.symlinkSync(process.execPath, path.join(toolRoot, "node"));
  fs.symlinkSync(jqPath, path.join(toolRoot, "jq"));
  fs.mkdirSync(path.join(serverRoot, "dist"), { recursive: true });
  fs.mkdirSync(path.join(serverRoot, "scripts"));
  fs.writeFileSync(
    path.join(serverRoot, "package.json"),
    JSON.stringify({
      name: "@verygoodplugins/mcp-evernote",
      version: "1.0.0",
      mcpName: "io.github.verygoodplugins/mcp-evernote",
      publishConfig: { access: "public" },
      files: ["dist", "scripts"],
      bin: { "mcp-evernote": "dist/index.js" },
      scripts: {
        lint: "eslint .",
        build: "tsc",
        test: "jest",
        "test:coverage": "jest --coverage",
      },
    }),
  );
  fs.writeFileSync(path.join(serverRoot, "package-lock.json"), "{}\n");
  fs.writeFileSync(
    path.join(serverRoot, "dist", "index.js"),
    "#!/usr/bin/env node\n",
  );
  fs.chmodSync(path.join(serverRoot, "dist", "index.js"), 0o755);

  try {
    const result = spawnSync("/bin/bash", [auditScript, serverRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ORG: "verygoodplugins",
        PATH: `${toolRoot}:/usr/bin:/bin`,
      },
    });

    assert.match(
      result.stdout,
      /✅ package files allowlist and bin targets are restricted/,
    );
    assert.doesNotMatch(
      result.stdout,
      /❌ package\.json must restrict files to dist\/docs and expose a dist\/ executable bin/,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
