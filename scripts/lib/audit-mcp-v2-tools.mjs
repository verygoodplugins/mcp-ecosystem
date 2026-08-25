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

function countTopLevelArguments(call) {
  const body = call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"));
  const depths = { parentheses: 0, braces: 0, brackets: 0 };
  let argumentsCount = body.trim() ? 1 : 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const nextCharacter = body[index + 1];

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
      argumentsCount += 1;
    }
  }

  return argumentsCount;
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
    if (countTopLevelArguments(registration) < 3) continue;
    summary.tools += 1;
    if (
      !/\boutputSchema\s*:/.test(registration) ||
      !/\bstructuredContent\s*:/.test(registration)
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
