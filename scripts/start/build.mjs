import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { versions, root, npm } from './common.mjs';
try {
  versions();
  const sites = join(root, 'sites');
  if (!existsSync(join(sites, 'node_modules/vinext/package.json'))) await npm(['run', 'install:ci'], sites);
  await npm(['run', 'build'], sites);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
