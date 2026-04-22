import fs from "node:fs";
import path from "node:path";

import {
  normalizeServerConfig,
  resolveServerProfiles,
} from "./ecosystem-config.mjs";

export function validateRepositorySync({
  repoRoot,
  server,
  profiles = resolveServerProfiles(server),
  syncReport = {
    packageManifestChanged: false,
    lockfileRefreshRequired: false,
    issues: [],
  },
}) {
  const normalized = normalizeServerConfig(server);
  const packageRoot = resolvePackageRoot(repoRoot, normalized);
  const issues = [];
  let packageJson = null;

  if (!fs.existsSync(packageRoot)) {
    issues.push({
      code: "missing-package-path",
      severity: "error",
      message: `Package path does not exist: ${normalized.packagePath}`,
    });
  }

  if (normalized.type === "typescript") {
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      issues.push({
        code: "missing-package-json",
        severity: "error",
        message: `Expected package.json at ${path.relative(repoRoot, packageJsonPath)}`,
      });
    } else {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const scripts = packageJson.scripts ?? {};
      for (const requiredScript of profiles.ci.requiredScripts ?? []) {
        if (!scripts[requiredScript]) {
          issues.push({
            code: "missing-script",
            severity: "error",
            message: `Missing required package.json script: ${requiredScript}`,
          });
        }
      }
    }
  } else {
    for (const requiredFile of profiles.ci.requiredFiles ?? []) {
      const requiredPath = path.join(packageRoot, requiredFile);
      if (!fs.existsSync(requiredPath)) {
        issues.push({
          code: "missing-required-file",
          severity: "error",
          message: `Missing required file: ${path.relative(repoRoot, requiredPath)}`,
        });
      }
    }
  }

  for (const requiredFile of profiles.release.requiredFiles ?? []) {
    const requiredPath = path.join(repoRoot, requiredFile);
    if (!fs.existsSync(requiredPath)) {
      issues.push({
        code: "missing-release-file",
        severity: "error",
        message: `Missing required release file: ${requiredFile}`,
      });
    }
  }

  if (syncReport.lockfileRefreshRequired) {
    issues.push(
      ...(syncReport.issues?.length
        ? syncReport.issues
        : [
            {
              code: "lockfile-refresh-required",
              severity: "error",
              message:
                "Managed dependency changes require refreshing the lockfile before opening a PR.",
            },
          ]),
    );
  }

  if (
    normalized.desktopExtension &&
    !profiles.release.supportsDesktopExtension
  ) {
    issues.push({
      code: "unsupported-desktop-extension-release",
      severity: "error",
      message:
        "This repo publishes a desktop extension, but the selected releaseProfile does not preserve extension build/release behavior.",
    });
  }

  if (
    normalized.desktopExtension &&
    profiles.release.supportsDesktopExtension
  ) {
    const scripts = packageJson?.scripts ?? {};
    if (!scripts["build:extension"]) {
      issues.push({
        code: "missing-extension-build-script",
        severity: "error",
        message:
          "Desktop extension releases require a build:extension package.json script.",
      });
    }
  }

  if (
    normalized.integrationTestSecrets?.length &&
    !profiles.ci.integrationTestCommand
  ) {
    issues.push({
      code: "unsupported-integration-test-profile",
      severity: "error",
      message:
        "This repo declares integration test secrets, but the selected ciProfile does not model integration test execution.",
    });
  }

  if (normalized.goPackagePath) {
    const goPackageRoot = path.join(repoRoot, normalized.goPackagePath);
    if (!fs.existsSync(goPackageRoot)) {
      issues.push({
        code: "missing-go-package-path",
        severity: "error",
        message: `Go package path does not exist: ${normalized.goPackagePath}`,
      });
    }

    const versionCheckScript =
      normalized.versionCheckScript ?? ".github/scripts/check_versions.py";
    const versionCheckScriptPath = path.join(repoRoot, versionCheckScript);
    if (!fs.existsSync(versionCheckScriptPath)) {
      issues.push({
        code: "missing-version-check-script",
        severity: "error",
        message: `Missing version check script: ${versionCheckScript}`,
      });
    }

    if (!profiles.ci.supportsGoBridge) {
      issues.push({
        code: "unsupported-go-ci-profile",
        severity: "error",
        message:
          "This repo includes a Go bridge, but the selected ciProfile does not preserve Go validation jobs.",
      });
    }
    if (!profiles.security.supportsGoBridge) {
      issues.push({
        code: "unsupported-go-security-profile",
        severity: "error",
        message:
          "This repo includes a Go bridge, but the selected securityProfile does not preserve Go security scanning.",
      });
    }
    if (!profiles.release.supportsGoBridgeArtifacts) {
      issues.push({
        code: "unsupported-go-release-profile",
        severity: "error",
        message:
          "This repo includes a Go bridge, but the selected releaseProfile does not preserve Go release artifacts.",
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    packageRoot,
  };
}

function resolvePackageRoot(repoRoot, server) {
  if (!server.packagePath || server.packagePath === ".") {
    return repoRoot;
  }
  return path.join(repoRoot, server.packagePath);
}
