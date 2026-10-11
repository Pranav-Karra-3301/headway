import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleEntry, isIgnored, isNoise } from '../console.mjs';

const frame = { url: 'http://x/assets/app.js', lineNumber: 9, columnNumber: 2 };

test('console.error and failed console.assert are errors; text joins the arguments', () => {
  const e = consoleEntry({
    method: 'Runtime.consoleAPICalled',
    params: {
      type: 'error',
      args: [{ type: 'string', value: 'boom' }, { type: 'number', value: 3 }, { type: 'object', subtype: 'error', description: 'TypeError: bad\n    at f (app.js:1:1)' }],
      stackTrace: { callFrames: [frame] },
    },
  });
  assert.deepEqual(e, { kind: 'console.error', text: 'boom 3 TypeError: bad\n    at f (app.js:1:1)', url: 'http://x/assets/app.js:10:3' });
  const a = consoleEntry({ method: 'Runtime.consoleAPICalled', params: { type: 'assert', args: [{ type: 'string', value: 'Assertion failed' }] } });
  assert.equal(a.kind, 'console.assert');
  assert.equal(a.url, null);
});

test('printf-style format strings are substituted (React / Vite log errors this way)', () => {
  const e = consoleEntry({
    method: 'Runtime.consoleAPICalled',
    params: {
      type: 'error',
      args: [
        { type: 'string', value: '%o\n\n%s\n\n%c%s %d%% %i' },
        { type: 'object', subtype: 'error', description: 'TypeError: Failed to fetch dynamically imported module: /src/x.tsx' },
        { type: 'string', value: 'The above error occurred in one of your React components.' },
        { type: 'string', value: 'color: red' },
        { type: 'string', value: 'React will retry.' },
        { type: 'number', value: 42.7 },
        { type: 'string', value: '7.9' },
        { type: 'string', value: 'extra' },
      ],
    },
  });
  assert.equal(e.text, 'TypeError: Failed to fetch dynamically imported module: /src/x.tsx\n\nThe above error occurred in one of your React components.\n\nReact will retry. 42% 7 extra');
  const plain = consoleEntry({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: '100% sure %z' }] } });
  assert.equal(plain.text, '100% sure %z');
});

test('warnings, logs and info are not errors', () => {
  for (const type of ['warning', 'log', 'info', 'debug']) {
    assert.equal(consoleEntry({ method: 'Runtime.consoleAPICalled', params: { type, args: [{ type: 'string', value: 'x' }] } }), null);
  }
  assert.equal(consoleEntry({ method: 'Log.entryAdded', params: { entry: { level: 'warning', source: 'other', text: 'meh' } } }), null);
  assert.equal(consoleEntry({ method: 'Page.loadEventFired', params: {} }), null);
});

test('uncaught exceptions and unhandled rejections are errors', () => {
  const e = consoleEntry({
    method: 'Runtime.exceptionThrown',
    params: { exceptionDetails: { text: 'Uncaught', url: 'http://x/a.js', lineNumber: 0, columnNumber: 4, exception: { description: 'Error: kaput\n    at x' } } },
  });
  assert.deepEqual(e, { kind: 'exception', text: 'Uncaught Error: kaput\n    at x', url: 'http://x/a.js:1:5' });
  const r = consoleEntry({ method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'Uncaught (in promise)', exception: { type: 'string', value: 'nope' } } } });
  assert.equal(r.text, 'Uncaught (in promise) nope');
});

test('browser log errors (network, security) are errors', () => {
  const e = consoleEntry({
    method: 'Log.entryAdded',
    params: { entry: { level: 'error', source: 'network', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://x/data/champion.json' } },
  });
  assert.deepEqual(e, { kind: 'network', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://x/data/champion.json' });
});

test('long texts are truncated', () => {
  const e = consoleEntry({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: 'y'.repeat(5000) }] } });
  assert.ok(e.text.length <= 1200);
  assert.match(e.text, /…$/);
});

test('isIgnored matches text or url; favicon 404s are always ignored', () => {
  const e = { kind: 'network', text: 'Failed to load resource: 404', url: 'http://x/favicon.ico' };
  assert.equal(isIgnored(e, []), true);
  assert.equal(isNoise(e), true);
  assert.equal(isNoise({ kind: 'network', text: 'Failed to load resource: 404', url: 'http://x/data/champion.json' }), false);
  const hmr = { kind: 'console.error', text: '[vite] failed to connect to websocket', url: null };
  assert.equal(isIgnored(hmr, []), false);
  assert.equal(isIgnored(hmr, [/\[vite\]/]), true);
  assert.equal(isIgnored({ kind: 'network', text: 'x', url: 'http://x/api/champion' }, [/\/api\//]), true);
});
