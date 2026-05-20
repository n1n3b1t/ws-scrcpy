#!/usr/bin/env node
// Self-test for src/server/goog-device/ServerVersion.ts.
//
// Usage:
//   node scripts/verify-server-version.mjs
//
// Imports the source-of-truth .ts file directly via Node's built-in
// TypeScript-stripping loader. ServerVersion uses a constructor
// parameter property (`public readonly versionString: string`), which
// the default `--experimental-strip-types` mode rejects, so this script
// re-spawns itself with `--experimental-transform-types` (Node 22.7+).
// On Node ≥ 23.6 type stripping is stable and parameter properties are
// also supported.
//
// Exits 0 when every row in TABLE passes, non-zero otherwise.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const NEEDED_FLAG = '--experimental-transform-types';
if (!process.execArgv.includes(NEEDED_FLAG)) {
    const result = spawnSync(
        process.execPath,
        [NEEDED_FLAG, '--no-warnings=ExperimentalWarning', ...process.argv.slice(1)],
        { stdio: 'inherit' },
    );
    process.exit(result.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, '../src/server/goog-device/ServerVersion.ts');
const { ServerVersion } = await import(modulePath);

const TABLE = [
    ['gt',           '1.19-ws6',  '1.19-ws5',  true],
    ['gt',           '1.19-ws10', '1.19-ws6',  true],   // numeric, not string
    ['gt',           '1.20',      '1.19-ws99', true],
    ['gt',           '4.0',       '3.3.4',     true],
    ['gt',           '3.3.4',     '3.3.4',     false],
    ['gt',           '4.0',       '4.0-rc1',   true],   // empty suffix > -rc1
    ['isCompatible', '1.19-ws6',  null,        true],
    ['isCompatible', '4.0',       null,        true],
    ['isCompatible', '',          null,        false],
];

let failed = 0;
for (const [op, a, b, expected] of TABLE) {
    const sv = new ServerVersion(a);
    const actual = op === 'gt' ? sv.gt(b) : sv.isCompatible();
    const pass = actual === expected;
    const label =
        op === 'gt'
            ? `ServerVersion(${JSON.stringify(a)}).gt(${JSON.stringify(b)})`
            : `ServerVersion(${JSON.stringify(a)}).isCompatible()`;
    console.log(
        `${pass ? 'PASS' : 'FAIL'}: ${label} === ${expected}  (got ${actual})`,
    );
    if (!pass) failed++;
}

const total = TABLE.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
