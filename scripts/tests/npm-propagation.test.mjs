import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  getServerConfig,
  normalizeServerConfig,
  renderManagedFiles,
  resolveServerProfiles,
} from "../lib/ecosystem-config.mjs";

const staticWorkflow = fs.readFileSync(
  "templates/typescript/.github/workflows/release-please.yml",
  "utf8",
);
const server = normalizeServerConfig(getServerConfig("mcp-freescout"));
const generatedWorkflow = renderManagedFiles(
  server,
  resolveServerProfiles(server),
)[".github/workflows/release-please.yml"];

function publicationScript(workflow) {
  const match = workflow.match(
    /      - name: Publish to MCP Registry\n(?:        timeout-minutes: \d+\n)?        run: \|\n([\s\S]*?)\n        env:/,
  );
  assert.ok(match, "expected MCP Registry publication step");
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
}

function exercise(script, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-publish-race-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@verygoodplugins/example", version: "3.2.0" }),
  );
  fs.writeFileSync(
    path.join(dir, "server.json"),
    JSON.stringify({
      version: options.serverVersion ?? "3.2.0",
      packages: [
        {
          registryType: "npm",
          identifier: "@verygoodplugins/example",
          version: options.serverVersion ?? "3.2.0",
        },
      ],
    }),
  );
  fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(bin, "npm"),
    `#!/bin/sh
set -eu
n=0; [ ! -f "$TEST_STATE/npm" ] || n=$(cat "$TEST_STATE/npm"); n=$((n + 1)); echo "$n" > "$TEST_STATE/npm"
printf '%s\\n' "$*" >> "$TEST_STATE/npm-args"
if [ "$TEST_NPM_MODE" = forbidden ]; then echo 'npm error code E401' >&2; exit 1; fi
if [ "$n" -le "$TEST_NPM_404S" ]; then echo 'npm error code E404' >&2; exit 1; fi
printf '"%s"\\n' "$TEST_NPM_VERSION"
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "mcp-publisher"),
    `#!/bin/sh
set -eu
if [ "$1" = login ]; then echo login >> "$TEST_STATE/login"; exit 0; fi
n=0; [ ! -f "$TEST_STATE/publish" ] || n=$(cat "$TEST_STATE/publish"); n=$((n + 1)); echo "$n" > "$TEST_STATE/publish"
if [ "$TEST_PUBLISH_MODE" = forbidden ]; then echo 'server returned status 403: forbidden' >&2; exit 1; fi
if [ "$TEST_PUBLISH_MODE" = ambiguous ]; then echo 'connection reset after upload' >&2; exit 1; fi
if [ "$TEST_PUBLISH_MODE" = other_package ]; then echo "server returned status 400: registry validation failed for package 0 (other): NPM package 'other' exists, but version '3.2.0' was not found (status: 404)" >&2; exit 1; fi
if [ "$n" -le "$TEST_PUBLISH_404S" ]; then echo "server returned status 400: registry validation failed for package 0 (@verygoodplugins/example): NPM package '@verygoodplugins/example' exists, but version '3.2.0' was not found (status: 404)" >&2; exit 1; fi
echo published
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      BASH_ENV: "",
      RUNNER_TEMP: dir,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_STATE: dir,
      TEST_NPM_MODE: options.npmMode ?? "",
      TEST_NPM_404S: String(options.npm404s ?? 0),
      TEST_NPM_VERSION: options.npmVersion ?? "3.2.0",
      TEST_PUBLISH_MODE: options.publishMode ?? "",
      TEST_PUBLISH_404S: String(options.publish404s ?? 0),
    },
  });
  const read = (file) =>
    fs.existsSync(path.join(dir, file))
      ? fs.readFileSync(path.join(dir, file), "utf8").trim()
      : "";
  const output = {
    status: result.status,
    error: result.error,
    stdout: result.stdout,
    stderr: result.stderr,
    npm: Number(read("npm")) || 0,
    publish: Number(read("publish")) || 0,
    login: read("login"),
    npmArgs: read("npm-args"),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return output;
}

test("static and generated workflows share the same propagation-safe publisher", () => {
  assert.equal(
    publicationScript(staticWorkflow),
    publicationScript(generatedWorkflow),
  );
  assert.match(
    generatedWorkflow,
    /- name: Publish to MCP Registry\n        timeout-minutes: 10/,
  );
});

test("waits for the exact npm version and retries only the matching registry propagation error", () => {
  const result = exercise(publicationScript(generatedWorkflow), {
    npm404s: 2,
    publish404s: 1,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.npm, 3);
  assert.equal(result.publish, 2);
  assert.equal(result.login, "login");
  assert.match(result.npmArgs, /@verygoodplugins\/example@3\.2\.0/);
  assert.match(result.npmArgs, /https:\/\/registry\.npmjs\.org/);
});

test("fails closed for nonmatching metadata and npm authorization errors", () => {
  const mismatch = exercise(publicationScript(generatedWorkflow), {
    serverVersion: "3.1.0",
  });
  assert.notEqual(mismatch.status, 0);
  assert.equal(mismatch.npm, 0);
  assert.equal(mismatch.publish, 0);
  const forbidden = exercise(publicationScript(generatedWorkflow), {
    npmMode: "forbidden",
  });
  assert.notEqual(forbidden.status, 0);
  assert.equal(forbidden.npm, 1);
  assert.equal(forbidden.publish, 0);
  const wrongVersion = exercise(publicationScript(generatedWorkflow), {
    npmVersion: "3.2.1",
  });
  assert.notEqual(wrongVersion.status, 0);
  assert.equal(wrongVersion.npm, 1);
  assert.equal(wrongVersion.publish, 0);
});

test("bounds propagation waits and never retries ambiguous or unrelated publication failures", () => {
  const unavailable = exercise(publicationScript(generatedWorkflow), {
    npm404s: 999,
  });
  assert.notEqual(unavailable.status, 0);
  assert.ok(unavailable.npm > 1 && unavailable.npm <= 30);
  assert.equal(unavailable.publish, 0);
  for (const publishMode of ["forbidden", "ambiguous", "other_package"]) {
    const result = exercise(publicationScript(generatedWorkflow), {
      publishMode,
    });
    assert.notEqual(result.status, 0, publishMode);
    assert.equal(result.publish, 1, publishMode);
  }
  const exhausted = exercise(publicationScript(generatedWorkflow), {
    publish404s: 999,
  });
  assert.notEqual(exhausted.status, 0);
  assert.ok(exhausted.publish > 1 && exhausted.publish <= 30);
});
