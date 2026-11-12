import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../tools/orchestrator/lib/yaml.mjs';
import { PACKAGE_ROOT, ROLES } from '../tools/orchestrator/lib/config.mjs';

test('config: svaka uloga iz ROLES je eksplicitno u agents.yml', async () => {
  const text = await fs.readFile(path.join(PACKAGE_ROOT, 'tools', 'config', 'agents.yml'), 'utf8');
  const config = parseYaml(text);
  for (const role of ROLES) {
    assert.ok(config.agents?.[role], `uloga ${role} nije u agents.yml (samo u DEFAULT_CONFIG)`);
    assert.ok(config.agents[role].adapter, `uloga ${role} nema adapter`);
  }
});

test('config: reviewer je drugi vendor od programera (nezavisan pregled)', async () => {
  const text = await fs.readFile(path.join(PACKAGE_ROOT, 'tools', 'config', 'agents.yml'), 'utf8');
  const config = parseYaml(text);
  assert.notEqual(config.agents.programer.harness, config.agents.reviewer.harness,
    'reviewer mora biti drugi vendor; inače nije nezavisan pregled');
});

test('config: produkcijski agents.real.yml uključuje Docker sandbox za challenge', async () => {
  const text = await fs.readFile(path.join(PACKAGE_ROOT, 'tools', 'config', 'agents.real.yml'), 'utf8');
  const config = parseYaml(text);
  assert.equal(config.pipeline?.challengeSandbox, 'docker',
    'produkcija mora izvršavati red-team skripte u kontejneru, ne na hostu');
});
