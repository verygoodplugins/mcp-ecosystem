#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  getServerConfig,
  normalizeServerConfig,
  resolveServerProfiles,
} from './lib/ecosystem-config.mjs';
import { validateRepositorySync } from './lib/validate-sync.mjs';

const args = process.argv.slice(2);
const [serverName, rawRepoRoot] = args;

if (!serverName || !rawRepoRoot) {
  console.error('Usage: validate-sync.mjs <server-name> <repo-root> [--sync-report <path>]');
  process.exit(1);
}

let reportPath = '';
for (let index = 2; index < args.length; index += 1) {
  if (args[index] === '--sync-report' && args[index + 1]) {
    reportPath = args[index + 1];
    index += 1;
  }
}

const repoRoot = path.resolve(rawRepoRoot);
const server = normalizeServerConfig(getServerConfig(serverName));
const profiles = resolveServerProfiles(server);
const syncReport = reportPath && fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  : { packageManifestChanged: false, lockfileRefreshRequired: false, issues: [] };

const result = validateRepositorySync({ repoRoot, server, profiles, syncReport });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}
