import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function syncTypescriptBaseline({ templatePackageJson, targetPath }) {
  const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  let changed = false;
  const changes = [];

  changed =
    syncMinimumValue(
      target,
      ["engines", "node"],
      templatePackageJson.engines?.node,
      changes,
      "engines.node",
    ) || changed;
  changed =
    syncDependencies(
      target,
      "dependencies",
      templatePackageJson.dependencies ?? {},
      changes,
      "dependencies",
    ) || changed;
  changed =
    syncDependencies(
      target,
      "devDependencies",
      templatePackageJson.devDependencies ?? {},
      changes,
      "devDependencies",
    ) || changed;

  if (changed) {
    fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
  }

  return {
    changed,
    packageManifestChanged: changed,
    lockfileRefreshRequired:
      changed &&
      fs.existsSync(path.join(path.dirname(targetPath), "package-lock.json")),
    changes,
    issues: [],
  };
}

export function syncPythonBaseline({ templateProject, targetPath }) {
  const originalText = fs.readFileSync(targetPath, "utf8");
  const parsed = parseTomlFile(targetPath);
  const project = parsed.project ?? {};
  const optionalDependencies =
    project["optional-dependencies"] ??
    parsed["project.optional-dependencies"] ??
    {};
  const normalizedProject = {
    requiresPython: project["requires-python"] ?? null,
    dependencies: project.dependencies ?? [],
    devDependencies: optionalDependencies.dev ?? [],
  };

  const updatedProject = {
    requiresPython: chooseHigherVersionFloor(
      normalizedProject.requiresPython,
      templateProject.requiresPython,
    ),
    dependencies: reconcileRequirements(
      normalizedProject.dependencies,
      templateProject.dependencies ?? [],
    ),
    devDependencies: reconcileRequirements(
      normalizedProject.devDependencies,
      templateProject.devDependencies ?? [],
    ),
  };

  let nextText = originalText;
  nextText = replaceTomlScalar(
    nextText,
    "project",
    "requires-python",
    updatedProject.requiresPython,
  );
  nextText = replaceTomlArray(
    nextText,
    "project",
    "dependencies",
    updatedProject.dependencies,
  );
  nextText = replaceTomlArray(
    nextText,
    "project.optional-dependencies",
    "dev",
    updatedProject.devDependencies,
  );

  const changed = nextText !== originalText;
  if (changed) {
    fs.writeFileSync(targetPath, nextText);
  }

  const changes = [];
  if (updatedProject.requiresPython !== normalizedProject.requiresPython) {
    changes.push({
      field: "project.requires-python",
      value: updatedProject.requiresPython,
    });
  }
  if (
    JSON.stringify(updatedProject.dependencies) !==
    JSON.stringify(normalizedProject.dependencies)
  ) {
    changes.push({
      field: "project.dependencies",
      value: updatedProject.dependencies,
    });
  }
  if (
    JSON.stringify(updatedProject.devDependencies) !==
    JSON.stringify(normalizedProject.devDependencies)
  ) {
    changes.push({
      field: "project.optional-dependencies.dev",
      value: updatedProject.devDependencies,
    });
  }

  return {
    changed,
    packageManifestChanged: changed,
    lockfileRefreshRequired:
      changed && fs.existsSync(path.join(path.dirname(targetPath), "uv.lock")),
    changes,
    issues:
      changed && fs.existsSync(path.join(path.dirname(targetPath), "uv.lock"))
        ? [
            {
              code: "uv-lock-refresh-required",
              severity: "error",
              message: "Managed dependency changes require refreshing uv.lock",
            },
          ]
        : [],
  };
}

export function attemptLockfileRefresh({
  serverType,
  targetRoot,
  report,
  runner = runCommand,
}) {
  if (!report.lockfileRefreshRequired) {
    return report;
  }

  if (serverType === "typescript") {
    const lockfilePath = path.join(targetRoot, "package-lock.json");
    if (!fs.existsSync(lockfilePath)) {
      return report;
    }

    const result = runner(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts"],
      {
        cwd: targetRoot,
        encoding: "utf8",
      },
    );
    return finalizeLockfileRefreshReport(report, result, "package-lock.json");
  }

  if (serverType === "python") {
    const lockfilePath = path.join(targetRoot, "uv.lock");
    if (!fs.existsSync(lockfilePath)) {
      return report;
    }

    const result = runner("uv", ["lock"], {
      cwd: targetRoot,
      encoding: "utf8",
    });
    return finalizeLockfileRefreshReport(report, result, "uv.lock");
  }

  return report;
}

export function parseTomlFile(targetPath) {
  return parseTomlText(fs.readFileSync(targetPath, "utf8"));
}

export function parseTomlText(text) {
  const sanitized = text
    .replaceAll("{name_underscore}", "placeholder_name_underscore")
    .replaceAll("{name}", "placeholder")
    .replaceAll("{description}", "placeholder-description");

  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import json, sys, tomllib",
        "data = tomllib.loads(sys.stdin.read())",
        "print(json.dumps(data))",
      ].join("\n"),
    ],
    { encoding: "utf8", input: sanitized },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to parse TOML text");
  }

  return JSON.parse(result.stdout);
}

function finalizeLockfileRefreshReport(report, result, lockfileName) {
  const issueCode =
    lockfileName === "package-lock.json"
      ? "package-lock-refresh-required"
      : "uv-lock-refresh-required";

  if (result.status === 0) {
    return {
      ...report,
      lockfileRefreshRequired: false,
      issues: report.issues.filter((issue) => issue.code !== issueCode),
      changes: [...report.changes, { field: lockfileName, value: "refreshed" }],
    };
  }

  return {
    ...report,
    issues: [
      {
        code: issueCode,
        severity: "error",
        message: `Managed dependency changes require refreshing ${lockfileName}: ${(
          result.error?.message ||
          result.stderr ||
          result.stdout ||
          "refresh failed"
        ).trim()}`,
      },
    ],
  };
}

function runCommand(command, args, options) {
  return spawnSync(command, args, options);
}

function syncValue(target, pathSegments, templateValue, changes, fieldName) {
  if (templateValue === undefined) {
    return false;
  }

  let cursor = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const key = pathSegments[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  const finalKey = pathSegments[pathSegments.length - 1];
  if (cursor[finalKey] === templateValue) {
    return false;
  }

  cursor[finalKey] = templateValue;
  changes.push({ field: fieldName, value: templateValue });
  return true;
}

function syncMinimumValue(
  target,
  pathSegments,
  templateValue,
  changes,
  fieldName,
) {
  if (templateValue === undefined) {
    return false;
  }

  let cursor = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const key = pathSegments[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  const finalKey = pathSegments[pathSegments.length - 1];
  const nextValue = chooseHigherVersionFloor(cursor[finalKey], templateValue);
  if (cursor[finalKey] === nextValue) {
    return false;
  }

  cursor[finalKey] = nextValue;
  changes.push({ field: fieldName, value: nextValue });
  return true;
}

function syncDependencies(
  target,
  sectionName,
  templateSection,
  changes,
  fieldPrefix,
) {
  if (!target[sectionName] || typeof target[sectionName] !== "object") {
    target[sectionName] = {};
  }

  let changed = false;
  for (const [packageName, version] of Object.entries(templateSection)) {
    if (
      target[sectionName][packageName] === undefined ||
      shouldReplaceVersion(target[sectionName][packageName], version)
    ) {
      target[sectionName][packageName] = version;
      changes.push({ field: `${fieldPrefix}.${packageName}`, value: version });
      changed = true;
    }
  }

  return changed;
}

function reconcileRequirements(currentEntries, templateEntries) {
  const nextEntries = [...currentEntries];
  for (const templateEntry of templateEntries) {
    const requirementName = extractRequirementName(templateEntry);
    const existingIndex = nextEntries.findIndex(
      (entry) => extractRequirementName(entry) === requirementName,
    );
    if (existingIndex === -1) {
      nextEntries.push(templateEntry);
      continue;
    }
    if (shouldReplaceVersion(nextEntries[existingIndex], templateEntry)) {
      nextEntries[existingIndex] = templateEntry;
    }
  }
  return nextEntries;
}

function extractRequirementName(entry) {
  return entry.split(/[<>=!~\s\[]/, 1)[0];
}

function shouldReplaceVersion(currentValue, templateValue) {
  const currentVersion = extractComparableVersion(currentValue);
  const templateVersion = extractComparableVersion(templateValue);

  if (!currentVersion || !templateVersion) {
    return currentValue !== templateValue;
  }

  return compareVersions(templateVersion, currentVersion) > 0;
}

function chooseHigherVersionFloor(currentValue, templateValue) {
  if (
    currentValue === undefined ||
    currentValue === null ||
    currentValue === ""
  ) {
    return templateValue;
  }
  if (
    templateValue === undefined ||
    templateValue === null ||
    templateValue === ""
  ) {
    return currentValue;
  }

  return shouldReplaceVersion(currentValue, templateValue)
    ? templateValue
    : currentValue;
}

function extractComparableVersion(value) {
  const match = String(value).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function replaceTomlScalar(text, sectionName, key, nextValue) {
  const lines = text.split("\n");
  let currentSection = "";
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }
    if (currentSection !== sectionName) {
      continue;
    }
    if (trimmed.startsWith(`${key} =`)) {
      lines[index] = `${key} = "${nextValue}"`;
      return lines.join("\n");
    }
  }
  return text;
}

function replaceTomlArray(text, sectionName, key, values) {
  const lines = text.split("\n");
  let currentSection = "";
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }
    if (currentSection === sectionName && trimmed === `${key} = [`) {
      startIndex = index;
      for (
        let innerIndex = index + 1;
        innerIndex < lines.length;
        innerIndex += 1
      ) {
        if (lines[innerIndex].trim() === "]") {
          endIndex = innerIndex;
          break;
        }
      }
      break;
    }
  }

  if (startIndex === -1 || endIndex === -1) {
    return text;
  }

  const replacement = [
    `${key} = [`,
    ...values.map((value) => `    "${value}",`),
    "]",
  ];
  lines.splice(startIndex, endIndex - startIndex + 1, ...replacement);
  return lines.join("\n");
}
