#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildManagedBaseline,
  getServerConfig,
  normalizeServerConfig,
  resolveServerProfiles,
} from "./lib/ecosystem-config.mjs";
import {
  attemptLockfileRefresh,
  parseTomlFile,
  syncPythonBaseline,
  syncTypescriptBaseline,
} from "./lib/sync-template-baseline-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const [rawServerInput, rawServerPath] = args;

if (!rawServerInput || !rawServerPath) {
  console.error(
    "Usage: sync-template-baseline.mjs <server-name|typescript|python|javascript> <path-to-server> [--report-file <path>]",
  );
  process.exit(1);
}

let reportFile = "";
for (let index = 2; index < args.length; index += 1) {
  if (args[index] === "--report-file" && args[index + 1]) {
    reportFile = args[index + 1];
    index += 1;
  }
}

const serverPath = path.resolve(rawServerPath);
const templateTypescriptPath = path.join(
  rootPath,
  "templates",
  "typescript",
  "package.json.template",
);
const templatePythonPath = path.join(
  rootPath,
  "templates",
  "python",
  "pyproject.toml.template",
);

let report;
const normalizedServerType =
  rawServerInput === "javascript" ? "typescript" : rawServerInput;

if (
  normalizedServerType === "typescript" ||
  normalizedServerType === "python"
) {
  report = attemptLockfileRefresh({
    serverType: normalizedServerType,
    targetRoot: serverPath,
    report: syncByType(normalizedServerType, serverPath),
  });
} else {
  const server = normalizeServerConfig(getServerConfig(rawServerInput));
  const profiles = resolveServerProfiles(server);
  const targetRoot = resolvePackagePath(serverPath, server.packagePath);
  report = attemptLockfileRefresh({
    serverType: server.type,
    targetRoot,
    report: syncByType(server.type, targetRoot, server, profiles),
  });
}

if (reportFile) {
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

function syncByType(serverType, targetRoot, server = null, profiles = null) {
  if (serverType === "typescript") {
    const targetPath = path.join(targetRoot, "package.json");
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Missing package.json at ${targetPath}`);
    }

    const templatePackageJson = JSON.parse(
      fs.readFileSync(templateTypescriptPath, "utf8"),
    );
    const managedBaseline =
      server && profiles
        ? buildManagedBaseline(server, profiles, templatePackageJson)
        : templatePackageJson;

    return syncTypescriptBaseline({
      templatePackageJson: managedBaseline,
      targetPath,
    });
  }

  if (serverType === "python") {
    const targetPath = path.join(targetRoot, "pyproject.toml");
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Missing pyproject.toml at ${targetPath}`);
    }

    const templateToml = parseTomlFile(templatePythonPath);
    const templateProject = {
      requiresPython: templateToml.project?.["requires-python"] ?? null,
      dependencies: templateToml.project?.dependencies ?? [],
      devDependencies:
        templateToml.project?.["optional-dependencies"]?.dev ?? [],
    };
    const managedBaseline =
      server && profiles
        ? buildManagedBaseline(server, profiles, templateProject)
        : templateProject;

    return syncPythonBaseline({
      templateProject: managedBaseline,
      targetPath,
    });
  }

  throw new Error(`Unsupported server type: ${serverType}`);
}

function resolvePackagePath(repoRoot, packagePath) {
  if (!packagePath || packagePath === ".") {
    return repoRoot;
  }
  return path.join(repoRoot, packagePath);
}
