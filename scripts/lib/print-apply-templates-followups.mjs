#!/usr/bin/env node
/**
 * After apply-templates.sh copies files, print only follow-ups that still apply.
 * Usage: node print-apply-templates-followups.mjs <server-root> <typescript|python>
 */
import fs from "node:fs";
import path from "node:path";

const displayRoot = process.argv[2] ?? "";
const type = process.argv[3] ?? "typescript";
const root = path.resolve(process.cwd(), displayRoot);

if (!displayRoot || !fs.existsSync(root)) {
  console.error(
    "Usage: print-apply-templates-followups.mjs <server-root> <typescript|python>",
  );
  process.exit(1);
}

const issues = [];

function checkServerJson() {
  const sj = path.join(root, "server.json");
  if (!fs.existsSync(sj)) {
    issues.push("Create server.json for MCP Registry (use 2025-12-11 schema)");
    return;
  }
  const raw = fs.readFileSync(sj, "utf8");
  if (!raw.includes("2025-12-11")) {
    issues.push("server.json: Use MCP Registry schema 2025-12-11");
  }
}

if (type === "typescript") {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    issues.push("package.json: File missing");
  } else {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      issues.push("package.json: Invalid JSON");
      pkg = null;
    }
    if (pkg) {
      if (!pkg.mcpName) {
        issues.push("package.json: Add 'mcpName' field");
      }
      if (pkg.publishConfig?.access !== "public") {
        issues.push("package.json: Ensure 'publishConfig.access' is 'public'");
      }
      if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
        issues.push("package.json: Ensure 'files' array is configured");
      }
      if (!pkg.scripts?.test) {
        issues.push("package.json: Ensure test script exists");
      }
    }
  }
  checkServerJson();
} else if (type === "python") {
  const pp = path.join(root, "pyproject.toml");
  if (!fs.existsSync(pp)) {
    issues.push("pyproject.toml: File missing");
  } else {
    const text = fs.readFileSync(pp, "utf8");
    if (!text.includes("[tool.mcp]")) {
      issues.push("pyproject.toml: Add [tool.mcp] section with 'name'");
    }
    if (!text.includes("[tool.ruff]")) {
      issues.push("pyproject.toml: Add [tool.ruff] configuration");
    }
    if (!text.includes("[tool.pytest") && !text.includes("[pytest]")) {
      issues.push("pyproject.toml: Ensure pytest configuration exists");
    }
  }
  checkServerJson();
} else {
  console.error(`Unknown type: ${type}`);
  process.exit(1);
}

if (issues.length > 0) {
  console.log("");
  console.log("📝 Files that may need manual updates:");
  console.log("---------------------------------------");
  for (const line of issues) {
    console.log(`• ${line}`);
  }
  console.log("");
  console.log("🔗 Next steps:");
  console.log("--------------");
  let n = 1;
  const pkgHints = issues.some(
    (i) => i.startsWith("package.json") || i.startsWith("pyproject.toml"),
  );
  const regHints = issues.some((i) => i.includes("server.json"));
  if (pkgHints) {
    console.log(`${n++}. Address the package manifest items above`);
  }
  if (regHints) {
    console.log(`${n++}. Add or fix server.json for MCP Registry`);
  }
  console.log(
    `${n++}. Configure Trusted Publishing on npm/PyPI when you publish`,
  );
  console.log(`${n++}. Run: ./scripts/audit-server.sh ${displayRoot}`);
} else {
  console.log("");
  console.log(
    "✅ Manifest checks passed (mcpName / pyproject, publishConfig, files, test script, server.json schema).",
  );
  console.log(`   Run: ./scripts/audit-server.sh ${displayRoot}`);
}
