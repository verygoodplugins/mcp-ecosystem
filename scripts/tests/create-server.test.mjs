import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const governanceFiles = [
  ".github/CODEOWNERS",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/dependabot.yml",
];

const unresolvedProjectPlaceholder =
  /\{(?:name|Name|name_underscore|description|repo_slug|package-name|Brief description under 100 characters)\}/;

function assertNoUnresolvedProjectPlaceholders(outputDir) {
  const pending = [outputDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "__pycache__") {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        assert.doesNotMatch(
          fs.readFileSync(entryPath, "utf8"),
          unresolvedProjectPlaceholder,
          `unresolved project placeholder in ${path.relative(outputDir, entryPath)}`,
        );
      }
    }
  }
}

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mcp-create-server-"),
  );
  const ecosystemRoot = path.join(fixtureRoot, "mcp-ecosystem");

  fs.mkdirSync(ecosystemRoot);
  fs.cpSync(
    path.join(repositoryRoot, "scripts"),
    path.join(ecosystemRoot, "scripts"),
    {
      recursive: true,
    },
  );
  fs.cpSync(
    path.join(repositoryRoot, "templates"),
    path.join(ecosystemRoot, "templates"),
    { recursive: true },
  );

  return { fixtureRoot, ecosystemRoot };
}

function scaffoldServer(
  type,
  name,
  description = "A scaffold regression test",
  githubOrg = "verygoodplugins",
) {
  const { fixtureRoot, ecosystemRoot } = createFixture();
  const script = path.join(ecosystemRoot, "scripts", "create-server.sh");

  execFileSync("/bin/bash", [script, type, name, description], {
    cwd: ecosystemRoot,
    env: {
      ...process.env,
      GITHUB_ORG: githubOrg,
      PATH: "/usr/bin:/bin",
    },
    stdio: "pipe",
  });

  return {
    fixtureRoot,
    outputDir: path.join(fixtureRoot, `mcp-${name}`),
  };
}

for (const type of ["typescript", "python"]) {
  test(`creates ${type} projects with rendered GitHub governance templates`, () => {
    const name = `scaffold-${type}`;
    const { fixtureRoot, outputDir } = scaffoldServer(type, name);

    try {
      for (const relativePath of governanceFiles) {
        assert.ok(
          fs.existsSync(path.join(outputDir, relativePath)),
          `missing ${relativePath}`,
        );
      }

      for (const relativePath of [
        ".github/workflows/ci.yml",
        ".github/workflows/security.yml",
      ]) {
        assert.ok(
          fs.existsSync(path.join(outputDir, relativePath)),
          `missing ${relativePath}`,
        );
      }

      assertNoUnresolvedProjectPlaceholders(outputDir);

      const securityPolicy = fs.readFileSync(
        path.join(outputDir, ".github", "SECURITY.md"),
        "utf8",
      );
      const issueConfig = fs.readFileSync(
        path.join(outputDir, ".github", "ISSUE_TEMPLATE", "config.yml"),
        "utf8",
      );

      for (const contents of [securityPolicy, issueConfig]) {
        assert.doesNotMatch(contents, /\{repo_slug\}|\{name\}/);
        assert.match(
          contents,
          new RegExp(
            `verygoodplugins/mcp-${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          ),
        );
      }

      if (type === "python") {
        const contributorGuidance = fs.readFileSync(
          path.join(outputDir, "AGENTS.md"),
          "utf8",
        );
        assert.match(
          contributorGuidance,
          /Python releases are tag-driven, not managed by Release Please\./,
        );

        const releaseWorkflow = fs.readFileSync(
          path.join(outputDir, ".github", "workflows", "release.yml"),
          "utf8",
        );
        assert.doesNotMatch(releaseWorkflow, /\{package-name\}/);
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("keeps Python runtime tool names dynamic after template rendering", () => {
  const { fixtureRoot, outputDir } = scaffoldServer("python", "weather");

  try {
    const serverSource = fs.readFileSync(
      path.join(outputDir, "src", "mcp_weather", "server.py"),
      "utf8",
    );

    assert.match(
      serverSource,
      /async def call_tool\(tool_name: str, arguments: dict\[str, Any\]\)/,
    );
    assert.match(
      serverSource,
      /raise ValueError\(f"Unknown tool: \{tool_name\}"\)/,
    );
    assert.doesNotMatch(serverSource, /Unknown tool: weather/);
    assert.match(
      serverSource,
      /await server\.run\(read_stream, write_stream, server\.create_initialization_options\(\)\)/,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

for (const type of ["typescript", "python"]) {
  test(`renders ampersands and slashes safely in ${type} descriptions`, () => {
    const description = "Research & development / analytics";
    const { fixtureRoot, outputDir } = scaffoldServer(
      type,
      `safe-${type}`,
      description,
    );

    try {
      const serverManifest = JSON.parse(
        fs.readFileSync(path.join(outputDir, "server.json"), "utf8"),
      );
      assert.equal(typeof serverManifest, "object");

      if (type === "typescript") {
        const packageManifest = JSON.parse(
          fs.readFileSync(path.join(outputDir, "package.json"), "utf8"),
        );
        assert.equal(packageManifest.description, description);
      } else {
        execFileSync(
          "python3",
          [
            "-c",
            "import pathlib, tomllib; tomllib.loads(pathlib.Path('pyproject.toml').read_text())",
          ],
          { cwd: outputDir, stdio: "pipe" },
        );
        execFileSync(
          "python3",
          [
            "-m",
            "py_compile",
            path.join(outputDir, "src", "mcp_safe_python", "server.py"),
          ],
          { cwd: outputDir, stdio: "pipe" },
        );
        assert.match(
          fs.readFileSync(path.join(outputDir, "pyproject.toml"), "utf8"),
          /description = "Research & development \/ analytics"/,
        );
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

for (const invalid of [
  { label: "traversal slug", name: "../escape", org: "verygoodplugins" },
  { label: "uppercase slug", name: "Bad-Name", org: "verygoodplugins" },
  { label: "unsafe owner", name: "safe-name", org: "owner/name" },
]) {
  test(`rejects ${invalid.label} before creating output`, () => {
    const { fixtureRoot, ecosystemRoot } = createFixture();
    const script = path.join(ecosystemRoot, "scripts", "create-server.sh");
    const before = fs.readdirSync(fixtureRoot).sort();

    try {
      const result = spawnSync(
        "/bin/bash",
        [script, "python", invalid.name, "Safe description"],
        {
          cwd: ecosystemRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_ORG: invalid.org,
            PATH: "/usr/bin:/bin",
          },
        },
      );

      assert.notEqual(result.status, 0);
      assert.deepEqual(fs.readdirSync(fixtureRoot).sort(), before);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

for (const invalid of [
  { label: "backslash", description: "Windows \\ path" },
  { label: "double quote", description: 'An "unsafe" description' },
  { label: "newline", description: "First line\nSecond line" },
]) {
  test(`rejects a ${invalid.label} in the description before creating output`, () => {
    const { fixtureRoot, ecosystemRoot } = createFixture();
    const script = path.join(ecosystemRoot, "scripts", "create-server.sh");
    const before = fs.readdirSync(fixtureRoot).sort();

    try {
      const result = spawnSync(
        "/bin/bash",
        [
          script,
          "python",
          `invalid-${invalid.label.replace(" ", "-")}`,
          invalid.description,
        ],
        {
          cwd: ecosystemRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_ORG: "verygoodplugins",
            PATH: "/usr/bin:/bin",
          },
        },
      );

      assert.notEqual(result.status, 0);
      assert.deepEqual(fs.readdirSync(fixtureRoot).sort(), before);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}
