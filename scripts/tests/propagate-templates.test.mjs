import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const propagateScript = path.resolve("scripts/propagate-templates.sh");
const propagationWorkflow = path.resolve(
  ".github/workflows/propagate-templates.yml",
);

function makeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

test("workflow uses github.token for read-only events and gates write runs on the sync token", () => {
  const workflow = fs.readFileSync(propagationWorkflow, "utf8");

  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /VGP_TEMPLATE_SYNC_TOKEN: \$\{\{[\s\S]*secrets\.VGP_TEMPLATE_SYNC_TOKEN[\s\S]*\}\}/);
  assert.match(workflow, /INPUT_EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /INPUT_DRY_RUN.*== "false"/);
  assert.match(workflow, /ARGS\+=\(--dry-run\)/);
});

test("workflow installs pinned uv for Python lockfile refreshes", () => {
  const workflow = fs.readFileSync(propagationWorkflow, "utf8");

  assert.match(
    workflow,
    /astral-sh\/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d/,
  );
  assert.match(workflow, /version: "0\.12\.5"/);
  assert.match(workflow, /command -v uv/);
});

test("propagation continues after a repository is blocked and reports every enabled repository", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-propagate-"));
  const binDir = path.join(tempRoot, "bin");
  const inventoryPath = path.join(tempRoot, "inventory.json");
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    inventoryPath,
    JSON.stringify({
      servers: [
        {
          name: "mcp-blocked",
          type: "typescript",
          github: "https://github.com/example/mcp-blocked",
          propagate: true,
        },
        {
          name: "mcp-ready",
          type: "typescript",
          github: "https://github.com/example/mcp-ready",
          propagate: true,
        },
      ],
    }),
  );
  makeExecutable(
    path.join(binDir, "gh"),
    `#!/usr/bin/env bash
if [[ "$1 $2" == "repo clone" && "$3" == "example/mcp-blocked" ]]; then
  echo "clone blocked" >&2
  exit 1
fi
if [[ "$1 $2" == "repo clone" ]]; then
  mkdir -p "$4"
fi
`,
  );
  makeExecutable(
    path.join(binDir, "git"),
    `#!/usr/bin/env bash
if [[ "$*" == *"rev-parse --short HEAD"* ]]; then
  echo test-sha
elif [[ "$*" == *"status --short"* ]]; then
  echo " M package.json"
fi
`,
  );
  makeExecutable(
    path.join(binDir, "node"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  makeExecutable(
    path.join(binDir, "npm"),
    "#!/usr/bin/env bash\nexit 0\n",
  );

  const result = spawnSync("bash", [propagateScript, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...process.env,
      INVENTORY_FILE: inventoryPath,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /==> mcp-ready \(typescript\)/);
  assert.match(result.stdout, /mcp-blocked\s+blocked/);
  assert.match(result.stdout, /mcp-ready\s+changes ready/);
});

test("propagation leaves TypeScript lockfile refresh to sync-template-baseline", () => {
  const script = fs.readFileSync(propagateScript, "utf8");

  assert.doesNotMatch(script, /npm install --package-lock-only/);
});
