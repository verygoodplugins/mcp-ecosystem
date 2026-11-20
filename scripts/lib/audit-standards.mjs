#!/usr/bin/env node
// Ecosystem standards audit (config/ecosystem-policy.json → standards).
// Usage: audit-standards.mjs <repo-root> [package-root]
// Prints one finding per line as LEVEL|message (OK, WARN, INFO). Heuristic and
// static: it reads source text and never runs the server or prints env values.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPlugins } from "./plugin-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(here, "../../config/ecosystem-policy.json");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "tests",
  "__tests__",
  "test",
  "plugins",
  "templates",
  "scripts",
  "examples",
]);

export function collectSource(root) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
          walk(path.join(dir, entry.name));
      } else if (
        /\.(?:[cm]?[jt]s|py)$/.test(entry.name) &&
        !/\.d\.ts$/.test(entry.name) &&
        !/\.(?:test|spec)\./.test(entry.name) &&
        !/^test_.*\.py$/.test(entry.name)
      ) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

// Returns canonical tool names. Definitions whose description starts with
// "[DEPRECATED" (legacy aliases kept behind <SERVICE>_LEGACY_TOOLS) are
// reported separately and do not count against the budget.
export function findToolNames(source) {
  const names = new Set();
  const legacy = new Set();
  const patterns = [
    /registerTool\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /\.tool\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g,
    /@(?:mcp|server|app)\.tool\(\s*name\s*=\s*['"]([A-Za-z0-9_]+)['"]/g,
    /@(?:mcp|server|app)\.tool\([^)]*\)\s*\n(?:\s*@[^\n]+\n)*\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/g,
    /Tool\(\s*name\s*=\s*['"]([A-Za-z0-9_]+)['"]/g,
    /\bname:\s*['"`]([a-z][a-z0-9]*_[a-z0-9_]+)['"`]\s*,\s*(?:\/\/[^\n]*)?\s*(?:title|description)\s*:/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const after = source.slice(
        match.index + match[0].length,
        match.index + match[0].length + 200,
      );
      if (/^[\s\S]{0,40}?\[?DEPRECATED/i.test(after)) legacy.add(match[1]);
      else names.add(match[1]);
    }
  }
  for (const name of legacy) names.delete(name);
  return Object.assign([...names].sort(), { legacy: [...legacy].sort() });
}

function readmeHeadings(repoRoot) {
  const file = path.join(repoRoot, "README.md");
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^#{2,3}\s/.test(line))
    .map((line) => line.replace(/^#+\s*/, "").toLowerCase());
}

export function auditStandards(
  repoRoot,
  packageRoot = repoRoot,
  policy = loadPolicy(),
) {
  const standards = policy.standards;
  const out = [];
  const ok = (message) => out.push(["OK", message]);
  const warn = (message) => out.push(["WARN", message]);
  const info = (message) => out.push(["INFO", message]);

  const source = collectSource(packageRoot);
  const tools = findToolNames(source);
  const toolPolicy = standards.toolDesign;

  // Tool design
  if (tools.legacy.length) {
    info(
      `${tools.legacy.length} deprecated alias tools excluded from the budget`,
    );
  }
  if (tools.length === 0) {
    info("No tool registrations detected statically");
  } else if (tools.length > toolPolicy.warnAboveTools) {
    warn(
      `${tools.length} tools exceeds the ${toolPolicy.warnAboveTools}-tool ceiling (target ${toolPolicy.targetTools}); consolidate with params/actions (docs/TOOL_DESIGN.md)`,
    );
  } else if (tools.length > toolPolicy.targetTools) {
    info(
      `${tools.length} tools is above the ${toolPolicy.targetTools}-tool target`,
    );
  } else {
    ok(
      `${tools.length} tools is within the ${toolPolicy.targetTools}-tool budget`,
    );
  }

  if (tools.length > 0) {
    const missing = toolPolicy.requiredAnnotations.filter(
      (hint) =>
        (source.match(new RegExp(`\\b${hint}\\b`, "g")) ?? []).length <
        tools.length,
    );
    if (missing.length)
      warn(
        `Fewer ${missing.join("/")} annotations than tools; every tool declares both`,
      );
    else ok("Annotation hints present for every tool");
  }

  const deleteTools = tools.filter((name) =>
    /(^|_)(delete|remove|purge|expunge|destroy)(_|$)/.test(name),
  );
  if (toolPolicy.deleteMustMentionTrash && deleteTools.length) {
    if (/trash|archive|restore|recoverable/i.test(source))
      ok(
        `Delete tools (${deleteTools.join(", ")}) reference trash/restore semantics`,
      );
    else
      warn(
        `Delete tools (${deleteTools.join(", ")}) never mention trash/restore; deletes must be recoverable by default`,
      );
  }

  // Credentials
  const envNames = new Set();
  for (const match of source.matchAll(
    /process\.env(?:\.|\[\s*['"])([A-Z][A-Z0-9_]+)|os\.(?:environ\.get|getenv|environ\[)\(?\s*['"]([A-Z][A-Z0-9_]+)/g,
  )) {
    envNames.add(match[1] ?? match[2]);
  }
  const forbidden = [...envNames].filter((name) =>
    standards.credentials.forbiddenEnvNames.includes(name),
  );
  if (forbidden.length)
    warn(
      `Unprefixed or deprecated env names: ${forbidden.join(", ")} (use <SERVICE>_*)`,
    );
  else if (envNames.size) ok("Env var names are service-prefixed");

  if (standards.credentials.requireEnvExample && envNames.size) {
    const hasExample = [".env.example", "env.example"].some(
      (name) =>
        fs.existsSync(path.join(repoRoot, name)) ||
        fs.existsSync(path.join(packageRoot, name)),
    );
    if (hasExample) ok(".env.example documents configuration");
    else warn(".env.example missing (list every env var with empty values)");
  }

  if (
    /\.(?:stack)\b[^\n]*(?:content|text|message|isError)|traceback\.format_exc\(\)/.test(
      source,
    )
  ) {
    warn("Stack traces may reach tool output; return sanitized messages");
  }

  // README sections
  const headings = readmeHeadings(repoRoot);
  if (headings) {
    const missing = standards.readme.requiredSections.filter(
      (section) =>
        !headings.some(
          (heading) =>
            heading.includes(section.toLowerCase()) ||
            (section === "Configuration" && heading.includes("configure")) ||
            (section === "Security" && /credential|privacy/.test(heading)),
        ),
    );
    if (missing.length) warn(`README missing sections: ${missing.join(", ")}`);
    else ok("README has Configuration, Security, and Support sections");
  }

  // Remote transport
  const remote = standards.remote;
  if (
    /StreamableHTTPServerTransport|streamable[-_]http|streamable_http_app/.test(
      source,
    )
  ) {
    info("Remote transport detected; checking the remote contract");
    const checks = [
      [
        new RegExp(
          `['"\`](?:${[remote.healthPath, ...remote.healthAliases].join("|")})['"\`]`,
        ),
        `GET ${remote.healthPath} health route`,
      ],
      [/timingSafeEqual|compare_digest/, "constant-time bearer comparison"],
      [/CALLER_KEYS/, "per-caller keys (<SERVICE>_HTTP_CALLER_KEYS)"],
      [/rateLimit|rate_limit|RateLimit|\b429\b/, "per-caller rate limit"],
      [
        /hostHeaderValidation|localhostHostValidation|allowed_hosts|TransportSecuritySettings|ALLOWED_HOSTS/,
        "Host-header (DNS rebinding) validation",
      ],
    ];
    for (const [pattern, label] of checks) {
      if (pattern.test(source)) ok(`Remote: ${label}`);
      else
        warn(`Remote: missing ${label} (docs/CREDENTIALS_AND_SECURITY.md §2)`);
    }
    if (
      !source.includes(`"${remote.healthPath}"`) &&
      !source.includes(`'${remote.healthPath}'`) &&
      remote.healthAliases.some(
        (alias) =>
          source.includes(`"${alias}"`) || source.includes(`'${alias}'`),
      )
    ) {
      info(
        `Remote: prefer ${remote.healthPath}; aliases ${remote.healthAliases.join(", ")} are accepted`,
      );
    }
  } else {
    info("stdio only (no Streamable HTTP transport detected)");
  }

  // Plugins
  const { plugins, findings } = checkPlugins(repoRoot, { tools });
  if (plugins.length === 0)
    info("No client plugin (optional; see docs/PLUGINS.md)");
  else if (findings.length === 0)
    ok(`Plugin layout valid: ${plugins.join(", ")}`);
  else findings.forEach((finding) => warn(`Plugin: ${finding}`));

  return { tools, findings: out };
}

export function loadPolicy() {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const repoRoot = path.resolve(process.argv[2] ?? ".");
  const packageRoot = path.resolve(process.argv[3] ?? repoRoot);
  const { findings } = auditStandards(repoRoot, packageRoot);
  process.stdout.write(
    findings.map(([level, message]) => `${level}|${message}`).join("\n") + "\n",
  );
}
