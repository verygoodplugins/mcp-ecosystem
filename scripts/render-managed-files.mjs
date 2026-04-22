#!/usr/bin/env node

import path from 'node:path';

import {
  getServerConfig,
  normalizeServerConfig,
  resolveServerProfiles,
  writeManagedFiles,
} from './lib/ecosystem-config.mjs';

const [, , serverName, rawRepoRoot] = process.argv;

if (!serverName || !rawRepoRoot) {
  console.error('Usage: render-managed-files.mjs <server-name> <repo-root>');
  process.exit(1);
}

const repoRoot = path.resolve(rawRepoRoot);
const server = normalizeServerConfig(getServerConfig(serverName));
const profiles = resolveServerProfiles(server);
const files = writeManagedFiles({ repoRoot, server, profiles });

console.log(
  JSON.stringify(
    {
      server: server.name,
      files: Object.keys(files),
    },
    null,
    2,
  ),
);
