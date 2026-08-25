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

function stripComments(source) {
  let result = "";
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote) {
      result += character;
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
      result += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    }
    result += character;
  }

  return result;
}

function findMatchingDelimiter(source, openIndex, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
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
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    else if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findTopLevelCharacter(source, target) {
  const depths = { parentheses: 0, braces: 0, brackets: 0 };
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
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
      character === target &&
      depths.parentheses === 0 &&
      depths.braces === 0 &&
      depths.brackets === 0
    ) {
      return index;
    }
  }

  return -1;
}

function parseObjectProperties(source) {
  let trimmed = source.trim();
  while (trimmed.startsWith("(")) trimmed = trimmed.slice(1).trimStart();
  if (!trimmed.startsWith("{")) return null;
  const closeIndex = findMatchingDelimiter(trimmed, 0, "{", "}");
  if (closeIndex < 0) return null;
  const staticSuffix = trimmed
    .slice(closeIndex + 1)
    .replace(/\)/g, "")
    .trim();
  if (
    staticSuffix &&
    !/^(?:as\s+const|(?:as|satisfies)\s+[A-Za-z_$][\w$.[\]<>, |&]*)$/.test(
      staticSuffix,
    )
  ) {
    return null;
  }

  const properties = new Map();
  for (const rawProperty of splitTopLevel(trimmed.slice(1, closeIndex))) {
    const property = rawProperty.trim();
    const colonIndex = findTopLevelCharacter(property, ":");
    if (colonIndex >= 0) {
      const rawName = property.slice(0, colonIndex).trim();
      const name = rawName.match(/^(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])$/);
      if (name) {
        properties.set(name[1] ?? name[2], property.slice(colonIndex + 1).trim());
      }
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(property)) {
      properties.set(property, property);
    }
  }

  return properties;
}

function skipWhitespace(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function parseReturnedObjectAt(source, start) {
  let index = skipWhitespace(source, start);
  while (source[index] === "(") {
    index = skipWhitespace(source, index + 1);
  }
  if (source[index] !== "{") return null;
  const end = findMatchingDelimiter(source, index, "{", "}");
  if (end < 0) return null;
  return { source: source.slice(index, end + 1), end };
}

function findFirstCodeArrow(source) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length - 1; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "=" && source[index + 1] === ">") return index;
  }
  return -1;
}

function findFunctionBodyStart(source, start) {
  let parentheses = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "{" && parentheses === 0) return index;
  }

  return -1;
}

function collectBlockReturnObjects(source) {
  const returns = [];
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (
      source.startsWith("function", index) &&
      !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(source[index + 8] ?? "")
    ) {
      const bodyStart = findFunctionBodyStart(source, index + 8);
      const bodyEnd =
        bodyStart >= 0
          ? findMatchingDelimiter(source, bodyStart, "{", "}")
          : -1;
      if (bodyEnd >= 0) index = bodyEnd;
      continue;
    }
    if (character === "=" && source[index + 1] === ">") {
      const bodyStart = skipWhitespace(source, index + 2);
      if (source[bodyStart] === "{") {
        const bodyEnd = findMatchingDelimiter(source, bodyStart, "{", "}");
        if (bodyEnd >= 0) index = bodyEnd;
      }
      continue;
    }
    if (
      source.startsWith("return", index) &&
      !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(source[index + 6] ?? "")
    ) {
      const returnedObject = parseReturnedObjectAt(source, index + 6);
      returns.push(returnedObject?.source ?? null);
      if (returnedObject) index = returnedObject.end;
    }
  }

  return returns;
}

function collectReturnObjects(handler) {
  const source = stripComments(handler);
  if (/^(?:async\s+)?function\b/.test(source.trimStart())) {
    const bodyStart = findFunctionBodyStart(source, 0);
    const bodyEnd =
      bodyStart >= 0
        ? findMatchingDelimiter(source, bodyStart, "{", "}")
        : -1;
    if (bodyEnd >= 0) {
      return collectBlockReturnObjects(source.slice(bodyStart + 1, bodyEnd));
    }
    return [];
  }

  const arrowIndex = findFirstCodeArrow(source);
  if (arrowIndex >= 0) {
    const bodyStart = skipWhitespace(source, arrowIndex + 2);
    if (source[bodyStart] === "{") {
      const bodyEnd = findMatchingDelimiter(source, bodyStart, "{", "}");
      if (bodyEnd < 0) return [];
      return collectBlockReturnObjects(source.slice(bodyStart + 1, bodyEnd));
    }
    if (source[bodyStart] === "(") {
      return [parseReturnedObjectAt(source, bodyStart)?.source ?? null];
    }
    return [null];
  }

  return [];
}

function isLiteralTrue(value) {
  return /^true(?:\s+as\s+const)?$/.test(value?.trim() ?? "");
}

function hasTextContent(value) {
  return (
    /\btype\s*:\s*["']text["']/.test(value ?? "") &&
    /\btext\s*:/.test(value ?? "")
  );
}

function hasMatchingStructuredJson(properties) {
  const structuredValue = properties.get("structuredContent")?.trim();
  const identifier = structuredValue?.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  const contentValue = properties.get("content");
  if (!identifier || !contentValue) return false;

  const jsonTextPattern =
    /\btext\s*:\s*JSON\.stringify\s*\(\s*([A-Za-z_$][\w$]*)(?=\s*[,\)])/g;
  return Array.from(contentValue.matchAll(jsonTextPattern)).some(
    (match) => match[1] === identifier,
  );
}

function analyzeToolRegistration(registration) {
  const cleanRegistration = stripComments(registration);
  const registrationArguments = splitRegisterToolArguments(cleanRegistration);
  if (registrationArguments.length < 3) return null;

  const options = parseObjectProperties(registrationArguments[1]);
  const annotations = options
    ? parseObjectProperties(options.get("annotations") ?? "")
    : null;
  const returnObjects = collectReturnObjects(registrationArguments[2]);
  let hasErrorResult = false;
  let hasSuccessfulResult = false;
  let everySuccessfulResultMatches = returnObjects.length > 0;

  for (const returnObject of returnObjects) {
    if (!returnObject) {
      everySuccessfulResultMatches = false;
      continue;
    }
    const properties = parseObjectProperties(returnObject);
    if (!properties) {
      everySuccessfulResultMatches = false;
      continue;
    }
    if (isLiteralTrue(properties.get("isError"))) {
      if (hasTextContent(properties.get("content"))) hasErrorResult = true;
      continue;
    }
    hasSuccessfulResult = true;
    if (!hasMatchingStructuredJson(properties)) {
      everySuccessfulResultMatches = false;
    }
  }

  return {
    resultsComplete:
      Boolean(options) &&
      options.has("title") &&
      options.has("inputSchema") &&
      options.has("outputSchema") &&
      hasSuccessfulResult &&
      everySuccessfulResultMatches,
    errorsComplete: hasErrorResult,
    annotationsComplete:
      Boolean(annotations) &&
      annotations.has("readOnlyHint") &&
      annotations.has("destructiveHint"),
  };
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
    const analysis = analyzeToolRegistration(registration);
    if (!analysis) continue;
    summary.tools += 1;
    if (!analysis.resultsComplete) summary.missingResults += 1;
    if (!analysis.errorsComplete) summary.missingErrors += 1;
    if (!analysis.annotationsComplete) summary.missingAnnotations += 1;
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
