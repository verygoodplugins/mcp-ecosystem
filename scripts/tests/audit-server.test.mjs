import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const auditScript = path.resolve("scripts/audit-server.sh");
const toolAuditScript = path.resolve("scripts/lib/audit-mcp-v2-tools.mjs");

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

test("Bash 5 audit identifies every missing MCP v2 safeguard and prints its summary", (t) => {
  const bash5 = findBash5();
  if (!bash5) {
    t.skip("Bash 5+ is unavailable");
    return;
  }

  const auditSource = fs.readFileSync(auditScript, "utf8");
  assert.doesNotMatch(auditSource, /\(\(WARNINGS\+\+\)\)/);

  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-v2-"));
  fs.mkdirSync(path.join(serverRoot, "src"));
  fs.mkdirSync(path.join(serverRoot, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(serverRoot, "package.json"),
    JSON.stringify({
      name: "@example/mcp-unsafe",
      version: "1.0.0",
      mcpName: "io.github.example/mcp-unsafe",
      dependencies: { "@modelcontextprotocol/server": "^2.0.0" },
      files: ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
      bin: { "mcp-unsafe": "dist/index.js" },
      scripts: { test: "node --test" },
    }),
  );
  fs.writeFileSync(
    path.join(serverRoot, "src", "index.ts"),
    `server.registerTool(
  'safe',
  {
    outputSchema: z.object({ result: z.string() }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => ({
    content: [],
    structuredContent: { result: 'ok' },
    isError: true,
  }),
);
server.registerTool('unsafe', {}, async () => ({ content: [] }));
`,
  );
  fs.writeFileSync(path.join(serverRoot, "README.md"), "# Unsafe\n");
  fs.writeFileSync(path.join(serverRoot, "LICENSE"), "MIT\n");
  fs.writeFileSync(path.join(serverRoot, "CHANGELOG.md"), "# Changelog\n");
  fs.writeFileSync(path.join(serverRoot, "server.json"), JSON.stringify({ packages: [{ transport: { type: "stdio" } }] }));
  fs.writeFileSync(path.join(serverRoot, ".github", "workflows", "release-please.yml"), "name: release\n");

  try {
    const result = spawnSync(bash5, [auditScript, serverRoot], {
      encoding: "utf8",
    });
    assert.match(result.stdout, /declare outputSchema and return structuredContent/);
    assert.match(result.stdout, /isError: true/);
    assert.match(result.stdout, /readOnlyHint and destructiveHint/);
    assert.match(result.stdout, /registry manifest after npm publication/);
    assert.match(result.stdout, /📊 Audit Summary/);
  } finally {
    fs.rmSync(serverRoot, { recursive: true, force: true });
  }
});

test("secret audit ignores test, spec, and env fixtures but reports production source", () => {
  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-secrets-"));
  const gnuGrepPath = [
    "/opt/homebrew/opt/grep/libexec/gnubin",
    "/usr/local/opt/grep/libexec/gnubin",
    process.env.PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  const auditEnv = { ...process.env, PATH: gnuGrepPath };
  fs.mkdirSync(path.join(serverRoot, "src"));
  fs.writeFileSync(path.join(serverRoot, "package.json"), "{}\n");
  fs.writeFileSync(
    path.join(serverRoot, "src", "credentials.test.ts"),
    "const api_key = 'fake-test-secret';\n",
  );
  fs.writeFileSync(
    path.join(serverRoot, "src", "credentials.spec.ts"),
    "const api_key = 'fake-spec-secret';\n",
  );
  fs.writeFileSync(
    path.join(serverRoot, "src", ".env.fixture"),
    "const api_key = 'fake-env-secret';\n",
  );

  try {
    const fixturesOnly = spawnSync("/bin/bash", [auditScript, serverRoot], {
      encoding: "utf8",
      env: auditEnv,
    });
    assert.doesNotMatch(fixturesOnly.stdout, /Potential hardcoded secrets/);
    assert.match(fixturesOnly.stdout, /No obvious hardcoded secrets/);

    fs.writeFileSync(
      path.join(serverRoot, "src", "credentials.ts"),
      "const api_key = 'production-secret';\n",
    );
    const productionSource = spawnSync("/bin/bash", [auditScript, serverRoot], {
      encoding: "utf8",
      env: auditEnv,
    });
    assert.match(productionSource.stdout, /Potential hardcoded secrets/);
  } finally {
    fs.rmSync(serverRoot, { recursive: true, force: true });
  }
});

test("MCP v2 audit ignores one-argument registerTool APIs", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tool-audit-"));
  fs.writeFileSync(
    path.join(sourceRoot, "openclaw-plugin.ts"),
    `api.registerTool({
  name: 'automem_store_memory',
  parameters: storeMemorySchema,
  async execute(args) {
    return jsonResult(await client.store(args));
  },
});
`,
  );

  try {
    const result = spawnSync(process.execPath, [toolAuditScript, sourceRoot], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "0|0|0|0");
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});
