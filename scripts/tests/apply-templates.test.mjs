import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getServerConfig,
  normalizeServerConfig,
  renderManagedFiles,
  resolveServerProfiles,
} from '../lib/ecosystem-config.mjs';

const applyScript = path.resolve('scripts/apply-templates.sh');
const propagationWorkflow = path.resolve(
  '.github/workflows/propagate-templates.yml',
);

function makeFreeScoutRepo({ ci, manifest } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-apply-'));
  const repoRoot = path.join(parent, 'mcp-freescout');
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@verygoodplugins/mcp-freescout',
        version: '2.4.6',
        description: 'FreeScout helpdesk ticket management',
      },
      null,
      2,
    ),
  );
  if (ci !== undefined) {
    fs.writeFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), ci);
  }
  if (manifest !== undefined) {
    fs.writeFileSync(
      path.join(repoRoot, '.release-please-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  }
  return repoRoot;
}

function applyTemplates(repoRoot, force = false) {
  return execFileSync(
    'bash',
    [applyScript, 'typescript', repoRoot, ...(force ? ['--force'] : [])],
    { encoding: 'utf8' },
  );
}

function renderedFreeScoutCi() {
  const server = normalizeServerConfig(getServerConfig('mcp-freescout'));
  return renderManagedFiles(server, resolveServerProfiles(server))[
    '.github/workflows/ci.yml'
  ];
}

test('apply preserves an existing profile-managed FreeScout CI file without --force', () => {
  const repoRoot = makeFreeScoutRepo({ ci: 'name: Custom FreeScout CI\n' });

  const output = applyTemplates(repoRoot);

  assert.equal(
    fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
    'name: Custom FreeScout CI\n',
  );
  assert.match(output, /profile-managed file already exists/);
});

test('apply creates profile-rendered FreeScout CI when the file is missing', () => {
  const repoRoot = makeFreeScoutRepo();

  applyTemplates(repoRoot);

  assert.equal(
    fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
    renderedFreeScoutCi(),
  );
});

test('apply --force regenerates profile-rendered FreeScout CI instead of static CI', () => {
  const repoRoot = makeFreeScoutRepo({ ci: 'name: Generic CI\n' });

  const output = applyTemplates(repoRoot, true);

  const ci = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  assert.equal(ci, renderedFreeScoutCi());
  assert.match(ci, /Integration \(non-blocking\)/);
  assert.match(output, /Rendered .github\/workflows\/ci.yml from mcp-freescout profile/);
});

test('apply synchronizes only the root release manifest version when forced', () => {
  const initialManifest = {
    '.': '1.0.0',
    'packages/companion': '3.2.1',
    metadata: { channel: 'beta' },
  };
  const repoRoot = makeFreeScoutRepo({ manifest: initialManifest });

  applyTemplates(repoRoot);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8'),
    ),
    initialManifest,
  );

  applyTemplates(repoRoot, true);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8'),
    ),
    {
      '.': '2.4.6',
      'packages/companion': '3.2.1',
      metadata: { channel: 'beta' },
    },
  );
});

test('propagation workflow pins token-bearing setup actions to full SHAs', () => {
  const workflow = fs.readFileSync(propagationWorkflow, 'utf8');

  assert.match(
    workflow,
    /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
  );
  assert.match(
    workflow,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
  );
});
