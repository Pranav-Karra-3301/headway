import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findChrome, launchChrome } from '../cdp.mjs';

test('findChrome honours an explicit path and never silently swaps it', () => {
  assert.equal(findChrome(process.execPath), process.execPath);
  assert.equal(findChrome('/definitely/not/here/chrome'), null);
});

test('launchChrome reports a missing explicit binary as a harness error', async () => {
  await assert.rejects(launchChrome({ chromePath: '/definitely/not/here/chrome' }), /Chrome not found at/);
});
