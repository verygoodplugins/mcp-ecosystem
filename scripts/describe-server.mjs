#!/usr/bin/env node

import { getServerConfig, normalizeServerConfig, resolveServerProfiles } from './lib/ecosystem-config.mjs';

const [, , serverName] = process.argv;

if (!serverName) {
  console.error('Usage: describe-server.mjs <server-name>');
  process.exit(1);
}

const server = normalizeServerConfig(getServerConfig(serverName));
const profiles = resolveServerProfiles(server);

console.log(
  JSON.stringify(
    {
      server,
      profiles,
    },
    null,
    2,
  ),
);
