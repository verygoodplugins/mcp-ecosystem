#!/usr/bin/env node
// Plugin shape checks for VGP MCP server repos (docs/PLUGINS.md).
// Kept byte-identical to templates/plugin/scripts/validate-plugin.mjs so
// server CI and the ecosystem audit run the same rules.
// Usage: node validate-plugin.mjs [repo-root] [--tools a,b,c] [--version x.y.z]
// Never prints variable values; only names and paths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

function readJson(file, findings, rel) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    findings.push(`${rel} is not valid JSON (${error.message})`);
    return null;
  }
}

function packageVersion(repoRoot) {
  const pkg = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      return JSON.parse(fs.readFileSync(pkg, "utf8")).version ?? null;
    } catch {
      return null;
    }
  }
  const pyproject = path.join(repoRoot, "pyproject.toml");
  if (fs.existsSync(pyproject)) {
    const match = fs
      .readFileSync(pyproject, "utf8")
      .match(/^version\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ?? null;
  }
  return null;
}

export function findPluginDirs(repoRoot) {
  const dirs = [];
  const pluginsRoot = path.join(repoRoot, "plugins");
  if (fs.existsSync(pluginsRoot)) {
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(pluginsRoot, entry.name);
      if (
        fs.existsSync(path.join(dir, ".cursor-plugin")) ||
        fs.existsSync(path.join(dir, ".claude-plugin"))
      ) {
        dirs.push(dir);
      }
    }
  }
  if (fs.existsSync(path.join(repoRoot, ".cursor-plugin", "plugin.json"))) {
    dirs.push(repoRoot);
  }
  return dirs;
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value))
    value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function checkMarketplace(repoRoot, rel, pluginDirs, findings) {
  const file = path.join(repoRoot, rel);
  if (!fs.existsSync(file)) {
    findings.push(`${rel} missing (lists plugins/<brand> for installs)`);
    return;
  }
  const data = readJson(file, findings, rel);
  if (!data) return;
  const entries = Array.isArray(data.plugins) ? data.plugins : [];
  if (entries.length === 0) findings.push(`${rel} lists no plugins`);
  const listed = new Set();
  for (const entry of entries) {
    const source =
      typeof entry.source === "string" ? entry.source : entry.source?.path;
    if (!entry.name || !source) {
      findings.push(`${rel} entry needs name and source`);
      continue;
    }
    const resolved = path.resolve(repoRoot, source);
    listed.add(resolved);
    if (!fs.existsSync(resolved))
      findings.push(`${rel} source not found: ${source}`);
  }
  for (const dir of pluginDirs) {
    if (dir !== repoRoot && !listed.has(path.resolve(dir))) {
      findings.push(`${rel} does not list ${path.relative(repoRoot, dir)}`);
    }
  }
}

export function checkPlugins(
  repoRoot,
  { tools = null, version = undefined } = {},
) {
  const findings = [];
  const checked = [];
  const pluginDirs = findPluginDirs(repoRoot);
  if (pluginDirs.length === 0) return { plugins: [], findings };
  const expectedVersion =
    version === undefined ? packageVersion(repoRoot) : version;
  const toolSet = tools && tools.length ? new Set(tools) : null;

  if (pluginDirs.some((dir) => dir !== repoRoot)) {
    checkMarketplace(
      repoRoot,
      ".cursor-plugin/marketplace.json",
      pluginDirs,
      findings,
    );
    checkMarketplace(
      repoRoot,
      ".claude-plugin/marketplace.json",
      pluginDirs,
      findings,
    );
  }

  for (const dir of pluginDirs) {
    const relDir = path.relative(repoRoot, dir) || ".";
    checked.push(relDir);
    for (const manifestRel of [
      ".cursor-plugin/plugin.json",
      ".claude-plugin/plugin.json",
    ]) {
      const rel = path.join(relDir, manifestRel);
      const file = path.join(dir, manifestRel);
      if (!fs.existsSync(file)) {
        findings.push(`${rel} missing`);
        continue;
      }
      const manifest = readJson(file, findings, rel);
      if (!manifest) continue;
      if (
        !manifest.name ||
        !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(manifest.name)
      ) {
        findings.push(`${rel} needs a kebab-case name`);
      }
      if (!manifest.version) findings.push(`${rel} has no version`);
      else if (expectedVersion && manifest.version !== expectedVersion) {
        findings.push(
          `${rel} version ${manifest.version} != package ${expectedVersion}`,
        );
      }
      if (
        manifest.logo &&
        !/^https?:/.test(manifest.logo) &&
        !fs.existsSync(path.join(dir, manifest.logo))
      ) {
        findings.push(`${rel} logo not found: ${manifest.logo}`);
      }

      if (manifestRel.startsWith(".cursor-plugin")) {
        const declared = new Set(
          Object.keys(manifest.variables?.properties ?? {}),
        );
        const mcpFile = path.join(dir, "mcp.json");
        const sources = [manifest.mcpServers];
        if (fs.existsSync(mcpFile))
          sources.push(
            readJson(mcpFile, findings, path.join(relDir, "mcp.json")),
          );
        for (const text of collectStrings(sources)) {
          for (const match of text.matchAll(PLACEHOLDER)) {
            if (!declared.has(match[1])) {
              findings.push(
                `${rel} uses \${${match[1]}} but does not declare it in variables`,
              );
            }
          }
        }
        for (const [name, prop] of Object.entries(
          manifest.variables?.properties ?? {},
        )) {
          if (/(KEY|SECRET|TOKEN|PASSWORD)$/.test(name) && prop.default) {
            findings.push(
              `${rel} variable ${name} looks secret and must not have a default`,
            );
          }
        }
        if (toolSet) {
          const servers =
            manifest.mcpServers && typeof manifest.mcpServers === "object"
              ? manifest.mcpServers
              : {};
          for (const server of Object.values(servers)) {
            for (const tool of server?.enabledTools ?? []) {
              if (!toolSet.has(tool))
                findings.push(`${rel} enabledTools has unknown tool ${tool}`);
            }
          }
        }
      } else if (
        typeof manifest.mcpServers === "string" &&
        !/^https?:/.test(manifest.mcpServers) &&
        !fs.existsSync(path.join(dir, manifest.mcpServers))
      ) {
        findings.push(
          `${rel} mcpServers file not found: ${manifest.mcpServers}`,
        );
      }
      if (manifestRel.startsWith(".claude-plugin") && manifest.userConfig) {
        for (const [key, option] of Object.entries(manifest.userConfig)) {
          if (
            /(key|secret|token|password)$/i.test(key) &&
            option.sensitive !== true
          ) {
            findings.push(
              `${rel} userConfig.${key} looks secret and should be sensitive: true`,
            );
          }
        }
      }
    }
  }
  return { plugins: checked, findings };
}

function parseArgs(argv) {
  const options = { root: process.cwd(), tools: null, version: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tools")
      options.tools = (argv[++index] ?? "").split(",").filter(Boolean);
    else if (arg === "--version") options.version = argv[++index] ?? null;
    else options.root = path.resolve(arg);
  }
  return options;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const options = parseArgs(process.argv.slice(2));
  const { plugins, findings } = checkPlugins(options.root, options);
  if (plugins.length === 0) {
    console.log("No plugins found.");
  } else if (findings.length === 0) {
    console.log(`Plugins OK: ${plugins.join(", ")}`);
  } else {
    for (const finding of findings) console.error(`plugin: ${finding}`);
    process.exit(1);
  }
}
