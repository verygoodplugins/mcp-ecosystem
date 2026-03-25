#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , rawServerType, rawServerPath] = process.argv;

if (!rawServerType || !rawServerPath) {
  console.error(
    'Usage: sync-template-baseline.mjs <typescript|python|javascript> <path-to-server>',
  );
  process.exit(1);
}

const serverType = rawServerType === 'javascript' ? 'typescript' : rawServerType;
const serverPath = path.resolve(rawServerPath);
const rootPath = path.resolve(__dirname, '..');

if (serverType === 'typescript') {
  syncTypescriptBaseline();
} else if (serverType === 'python') {
  syncPythonBaseline();
} else {
  console.error(`Unsupported server type: ${rawServerType}`);
  process.exit(1);
}

function syncTypescriptBaseline() {
  const templatePath = path.join(rootPath, 'templates', 'typescript', 'package.json.template');
  const targetPath = path.join(serverPath, 'package.json');

  if (!fs.existsSync(targetPath)) {
    console.error(`Missing package.json at ${targetPath}`);
    process.exit(1);
  }

  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

  let changed = false;

  changed = syncValue(target, ['engines', 'node'], template.engines?.node) || changed;
  changed = syncDependencies(target, 'dependencies', template.dependencies) || changed;
  changed = syncDependencies(target, 'devDependencies', template.devDependencies) || changed;

  if (changed) {
    fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
    console.log(`Updated ${targetPath}`);
  }
}

function syncPythonBaseline() {
  const templatePath = path.join(rootPath, 'templates', 'python', 'pyproject.toml.template');
  const targetPath = path.join(serverPath, 'pyproject.toml');

  if (!fs.existsSync(targetPath)) {
    console.error(`Missing pyproject.toml at ${targetPath}`);
    process.exit(1);
  }

  const templateText = fs.readFileSync(templatePath, 'utf8');
  let targetText = fs.readFileSync(targetPath, 'utf8');

  let changed = false;
  const requiresPython = getTomlValue(templateText, 'project', 'requires-python');

  const requiresPythonSync = syncTomlValue(targetText, 'project', 'requires-python', requiresPython);
  targetText = requiresPythonSync.text;
  changed = requiresPythonSync.changed || changed;

  const dependencySync = syncTomlArray(
    targetText,
    'project',
    'dependencies',
    getTomlArray(templateText, 'project', 'dependencies'),
  );
  targetText = dependencySync.text;
  changed = dependencySync.changed || changed;

  const devDependencySync = syncTomlArray(
    targetText,
    'project.optional-dependencies',
    'dev',
    getTomlArray(templateText, 'project.optional-dependencies', 'dev'),
  );
  targetText = devDependencySync.text;
  changed = devDependencySync.changed || changed;

  if (changed) {
    fs.writeFileSync(targetPath, targetText);
    console.log(`Updated ${targetPath}`);
  }
}

function syncValue(target, pathSegments, templateValue) {
  if (templateValue === undefined) {
    return false;
  }

  let cursor = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const key = pathSegments[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  const finalKey = pathSegments[pathSegments.length - 1];
  if (cursor[finalKey] === templateValue) {
    return false;
  }

  cursor[finalKey] = templateValue;
  return true;
}

function syncDependencies(target, sectionName, templateSection = {}) {
  const targetSection = target[sectionName];
  if (!targetSection || typeof targetSection !== 'object') {
    return false;
  }

  let changed = false;
  for (const [packageName, version] of Object.entries(templateSection)) {
    if (
      Object.prototype.hasOwnProperty.call(targetSection, packageName) &&
      targetSection[packageName] !== version
    ) {
      targetSection[packageName] = version;
      changed = true;
    }
  }

  return changed;
}

function syncTomlValue(text, sectionName, key, templateValue) {
  if (!templateValue) {
    return { changed: false, text };
  }

  const lines = text.split('\n');
  let currentSection = '';
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (currentSection !== sectionName) {
      continue;
    }

    const match = lines[index].match(/^(\s*)([A-Za-z0-9._-]+)\s*=\s*(".*")\s*$/);
    if (!match || match[2] !== key) {
      continue;
    }

    const replacement = `${match[1]}${key} = ${templateValue}`;
    if (lines[index] !== replacement) {
      lines[index] = replacement;
      changed = true;
    }
    break;
  }

  return { changed, text: lines.join('\n') };
}

function getTomlValue(text, sectionName, key) {
  const lines = text.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (currentSection !== sectionName) {
      continue;
    }

    const match = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*(".*")\s*$/);
    if (match && match[1] === key) {
      return match[2];
    }
  }

  return null;
}

function getTomlArray(text, sectionName, key) {
  const lines = text.split('\n');
  let currentSection = '';
  let collecting = false;
  const values = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!collecting && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (!collecting && currentSection === sectionName && trimmed === `${key} = [`) {
      collecting = true;
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (trimmed === ']') {
      break;
    }

    const match = line.match(/^\s*"([^"]+)",?\s*$/);
    if (match) {
      values.push(match[1]);
    }
  }

  return values;
}

function syncTomlArray(text, sectionName, key, templateEntries) {
  if (templateEntries.length === 0) {
    return { changed: false, text };
  }

  const templateByName = new Map(
    templateEntries.map((entry) => [extractRequirementName(entry), entry]),
  );

  const lines = text.split('\n');
  let currentSection = '';
  let startIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (currentSection === sectionName && trimmed === `${key} = [`) {
      startIndex = index;
      for (let innerIndex = index + 1; innerIndex < lines.length; innerIndex += 1) {
        if (lines[innerIndex].trim() === ']') {
          endIndex = innerIndex;
          break;
        }
      }
      break;
    }
  }

  if (startIndex === -1 || endIndex === -1) {
    return { changed: false, text };
  }

  let changed = false;
  const updatedLines = [...lines];

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const match = updatedLines[index].match(/^(\s*)"([^"]+)"(,?)\s*$/);
    if (!match) {
      continue;
    }

    const requirementName = extractRequirementName(match[2]);
    if (!templateByName.has(requirementName)) {
      continue;
    }

    const replacement = `${match[1]}"${templateByName.get(requirementName)}"${match[3] || ','}`;
    if (updatedLines[index] !== replacement) {
      updatedLines[index] = replacement;
      changed = true;
    }
  }

  return { changed, text: updatedLines.join('\n') };
}

function extractRequirementName(entry) {
  return entry.split(/[<>=!~\s\[]/, 1)[0];
}
