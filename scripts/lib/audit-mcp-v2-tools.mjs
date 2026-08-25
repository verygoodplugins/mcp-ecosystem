#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] ?? ".");
const sourceFiles = [];

function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        collectSourceFiles(entryPath);
      }
      continue;
    }

    if (
      /\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
      !/\.(?:test|spec)\./.test(entry.name) &&
      !entry.name.startsWith(".env")
    ) {
      sourceFiles.push(entryPath);
    }
  }
}

function findRegisterToolCalls(source) {
  const calls = [];
  const matcher = /\bregisterTool\s*\(/g;
  let match;

  while ((match = matcher.exec(source)) !== null) {
    const openParen = source.indexOf("(", match.index);
    let depth = 0;
    let quote = "";
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openParen; index < source.length; index += 1) {
      const character = source[index];
      const nextCharacter = source[index + 1];

      if (lineComment) {
        lineComment = character !== "\n";
        continue;
      }
      if (blockComment) {
        if (character === "*" && nextCharacter === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }
      if (character === "/" && nextCharacter === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(match.index, index + 1));
          matcher.lastIndex = index + 1;
          break;
        }
      }
    }
  }

  return calls;
}

function splitTopLevel(source) {
  const depths = { parentheses: 0, braces: 0, brackets: 0 };
  const parts = [];
  let partStart = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      lineComment = character !== "\n";
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(") depths.parentheses += 1;
    else if (character === ")") depths.parentheses -= 1;
    else if (character === "{") depths.braces += 1;
    else if (character === "}") depths.braces -= 1;
    else if (character === "[") depths.brackets += 1;
    else if (character === "]") depths.brackets -= 1;
    else if (
      character === "," &&
      depths.parentheses === 0 &&
      depths.braces === 0 &&
      depths.brackets === 0
    ) {
      parts.push(source.slice(partStart, index));
      partStart = index + 1;
    }
  }

  const finalPart = source.slice(partStart);
  if (finalPart.trim()) parts.push(finalPart);
  return parts;
}

function splitRegisterToolArguments(call) {
  const body = call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"));
  return splitTopLevel(body);
}

function hasTopLevelOption(options, name) {
  const trimmed = options.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const properties = splitTopLevel(trimmed.slice(1, -1));
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const explicitProperty = new RegExp(
    `^(?:${escapedName}|["']${escapedName}["'])\\s*:`,
  );
  const shorthandProperty = new RegExp(`^${escapedName}$`);

  return properties.some((property) => {
    const normalized = property
      .replace(/^\s*(?:(?:\/\/[^\n]*\n)|(?:\/\*[\s\S]*?\*\/))\s*/g, "")
      .trim();
    return explicitProperty.test(normalized) || shorthandProperty.test(normalized);
  });
}

function hasMatchingStructuredJson(registration) {
  const jsonTextPattern =
    /\btext\s*:\s*JSON\.stringify\s*\(\s*([A-Za-z_$][\w$]*)(?=\s*[,\)])/g;
  let match;

  while ((match = jsonTextPattern.exec(registration)) !== null) {
    const valueName = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const structuredPattern = new RegExp(
      `\\bstructuredContent\\s*:\\s*${valueName}\\b`,
    );
    if (structuredPattern.test(registration)) return true;
  }

  return false;
}

if (fs.existsSync(sourceRoot)) {
  collectSourceFiles(sourceRoot);
}

const summary = {
  tools: 0,
  missingResults: 0,
  missingErrors: 0,
  missingAnnotations: 0,
};

for (const sourceFile of sourceFiles) {
  const source = fs.readFileSync(sourceFile, "utf8");
  for (const registration of findRegisterToolCalls(source)) {
    const registrationArguments = splitRegisterToolArguments(registration);
    if (registrationArguments.length < 3) continue;
    const options = registrationArguments[1];
    summary.tools += 1;
    if (
      !hasTopLevelOption(options, "title") ||
      !hasTopLevelOption(options, "inputSchema") ||
      !hasTopLevelOption(options, "outputSchema") ||
      !hasMatchingStructuredJson(registration)
    ) {
      summary.missingResults += 1;
    }
    if (!/\bisError\s*:\s*true\b/.test(registration)) {
      summary.missingErrors += 1;
    }
    if (
      !/\breadOnlyHint\s*:/.test(registration) ||
      !/\bdestructiveHint\s*:/.test(registration)
    ) {
      summary.missingAnnotations += 1;
    }
  }
}

process.stdout.write(
  [
    summary.tools,
    summary.missingResults,
    summary.missingErrors,
    summary.missingAnnotations,
  ].join("|"),
);
