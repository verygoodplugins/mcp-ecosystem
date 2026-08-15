import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-create-server-"));
  const ecosystemRoot = path.join(fixtureRoot, "mcp-ecosystem");

  fs.mkdirSync(ecosystemRoot);
  fs.cpSync(path.join(repositoryRoot, "scripts"), path.join(ecosystemRoot, "scripts"), {
    recursive: true,
  });
  fs.cpSync(
    path.join(repositoryRoot, "templates"),
    path.join(ecosystemRoot, "templates"),
    { recursive: true },
  );

  return { fixtureRoot, ecosystemRoot };
}

function scaffoldServer(type, name) {
  const { fixtureRoot, ecosystemRoot } = createFixture();
  const script = path.join(ecosystemRoot, "scripts", "create-server.sh");

  execFileSync("/bin/bash", [script, type, name, "A scaffold regression test"], {
    cwd: ecosystemRoot,
    env: {
      ...process.env,
      GITHUB_ORG: "verygoodplugins",
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
          new RegExp(`verygoodplugins/mcp-${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
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
    assert.match(serverSource, /raise ValueError\(f"Unknown tool: \{tool_name\}"\)/);
    assert.doesNotMatch(serverSource, /Unknown tool: weather/);
    assert.match(
      serverSource,
      /await server\.run\(read_stream, write_stream, server\.create_initialization_options\(\)\)/,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
