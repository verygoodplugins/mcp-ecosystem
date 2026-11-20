import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  auditStandards,
  findToolNames,
  loadPolicy,
} from "../lib/audit-standards.mjs";
import { checkPlugins } from "../lib/plugin-checks.mjs";

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-standards-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return root;
}

function levels(findings, level) {
  return findings
    .filter(([found]) => found === level)
    .map(([, message]) => message);
}

const README = "# mcp-x\n\n## Configuration\n\n## Security\n\n## Support\n";

test("policy declares the standards block used by the audit", () => {
  const { standards } = loadPolicy();
  assert.equal(standards.toolDesign.targetTools, 15);
  assert.ok(
    standards.toolDesign.warnAboveTools > standards.toolDesign.targetTools,
  );
  assert.equal(standards.remote.mcpPath, "/mcp");
  assert.equal(standards.remote.healthPath, "/health");
  assert.equal(standards.plugin.layout, "in-repo");
  for (const doc of Object.values(standards.docs)) {
    assert.ok(fs.existsSync(path.resolve(doc)), `${doc} exists`);
  }
});

test("findToolNames counts registrations and excludes deprecated aliases", () => {
  const source = `
    server.registerTool('x_get_thing', { title: 'Get' });
    const tools = [{ name: "x_list_things", description: "List" }];
    const legacy = [{ name: "x_get_thing_text", description: "[DEPRECATED - use x_get_thing] Text" }];
  `;
  const tools = findToolNames(source);
  assert.deepEqual([...tools], ["x_get_thing", "x_list_things"]);
  assert.deepEqual(tools.legacy, ["x_get_thing_text"]);
});

test("audit warns when the tool budget ceiling is exceeded", () => {
  const registrations = Array.from(
    { length: 21 },
    (_, index) =>
      `server.registerTool('x_tool_${index}', { annotations: { readOnlyHint: true, destructiveHint: false } });`,
  ).join("\n");
  const root = makeRepo({ "README.md": README, "src/index.ts": registrations });
  const { findings } = auditStandards(root);
  assert.ok(
    levels(findings, "WARN").some((message) =>
      /21 tools exceeds/.test(message),
    ),
  );
});

test("audit flags unprefixed env names, missing env example, and unrecoverable deletes", () => {
  const root = makeRepo({
    "README.md": "# mcp-x\n\n## Support\n",
    "src/index.ts": `
      const key = process.env.API_KEY;
      server.registerTool('x_delete_thing', { annotations: { readOnlyHint: false, destructiveHint: true } });
    `,
  });
  const warnings = levels(auditStandards(root).findings, "WARN");
  assert.ok(warnings.some((message) => /Unprefixed .*API_KEY/.test(message)));
  assert.ok(warnings.some((message) => /\.env\.example missing/.test(message)));
  assert.ok(warnings.some((message) => /never mention trash/.test(message)));
  assert.ok(
    warnings.some((message) =>
      /README missing sections: Configuration, Security/.test(message),
    ),
  );
});

test("remote transport must meet the auth, health, rate-limit, and host contract", () => {
  const insecure = makeRepo({
    "README.md": README,
    "src/http.ts": "import { StreamableHTTPServerTransport } from 'sdk';",
  });
  const insecureWarnings = levels(auditStandards(insecure).findings, "WARN");
  assert.equal(
    insecureWarnings.filter((message) => message.startsWith("Remote:")).length,
    5,
  );

  const secure = makeRepo({
    "README.md": README,
    "src/http.ts": `
      import { StreamableHTTPServerTransport } from 'sdk';
      import { localhostHostValidation } from 'sdk';
      const keys = process.env.X_HTTP_CALLER_KEYS;
      app.get('/health', ok); timingSafeEqual(a, b); rateLimit({});
    `,
    ".env.example": "X_HTTP_CALLER_KEYS=\n",
  });
  const secureWarnings = levels(auditStandards(secure).findings, "WARN");
  assert.deepEqual(
    secureWarnings.filter((message) => message.startsWith("Remote:")),
    [],
  );
});

test("plugin checks catch drift between manifests, marketplaces, and tools", () => {
  const root = makeRepo({
    "package.json": { name: "mcp-x", version: "1.2.0" },
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [{ name: "x", source: "./plugins/x" }],
    },
    "plugins/x/.cursor-plugin/plugin.json": {
      name: "x",
      version: "1.1.0",
      variables: {
        type: "object",
        properties: { X_HTTP_CALLER_KEY: { type: "string", default: "oops" } },
      },
      mcpServers: {
        x: {
          url: "${X_MCP_URL}",
          headers: { Authorization: "Bearer ${X_HTTP_CALLER_KEY}" },
          enabledTools: ["x_get_thing", "x_gone"],
        },
      },
    },
    "plugins/x/.claude-plugin/plugin.json": {
      name: "x",
      version: "1.2.0",
      mcpServers: "./.mcp.json",
      userConfig: {
        caller_key: { type: "string", title: "Key", description: "Key" },
      },
    },
  });
  const { plugins, findings } = checkPlugins(root, { tools: ["x_get_thing"] });
  assert.deepEqual(plugins, ["plugins/x"]);
  const text = findings.join("\n");
  assert.match(text, /\.cursor-plugin\/marketplace\.json missing/);
  assert.match(text, /version 1\.1\.0 != package 1\.2\.0/);
  assert.match(text, /X_MCP_URL\} but does not declare it/);
  assert.match(
    text,
    /X_HTTP_CALLER_KEY looks secret and must not have a default/,
  );
  assert.match(text, /unknown tool x_gone/);
  assert.match(text, /userConfig\.caller_key .* sensitive: true/);
  assert.match(text, /mcpServers file not found: \.\/\.mcp\.json/);
});

test("plugin template validator stays identical to the audit library", () => {
  assert.equal(
    fs.readFileSync("templates/plugin/scripts/validate-plugin.mjs", "utf8"),
    fs.readFileSync("scripts/lib/plugin-checks.mjs", "utf8"),
  );
});

test("plugin template manifests are valid JSON with declared variables", () => {
  const templateRoot = path.resolve("templates/plugin");
  const { findings } = checkPlugins(templateRoot, { version: "{version}" });
  const unexpected = findings.filter(
    (finding) =>
      !/kebab-case name|source not found|does not list/.test(finding),
  );
  assert.deepEqual(unexpected, []);
});
