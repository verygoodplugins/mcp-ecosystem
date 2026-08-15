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
