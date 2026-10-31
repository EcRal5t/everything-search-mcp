import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AgentClient } from '../src/agent.js';
import { composeQuery, normalizeRoot } from '../src/everything.js';
import { compactSearch } from '../src/compact.js';
import { searchSchema } from '../src/schema.js';

const client = (rows, env = {}) => new AgentClient({ EVERYTHING_URL: 'http://example.test/', ...env }, {
  fetch: async url => {
    const values = typeof rows === 'function' ? rows(url.searchParams.get('search')) : rows;
    const offset = Number(url.searchParams.get('offset')), count = Number(url.searchParams.get('count'));
    return new Response(JSON.stringify({ totalResults: values.length, results: values.slice(offset, offset + count) }));
  },
});
const row = (name, size, parent = 'C:\\Test') => ({ type: 'file', name, path: parent, size });

test('root and regex scopes preserve query grouping', () => {
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:/Test', query: 'foo | bar' })), 'path:"C:\\Test\\" <foo | bar>');
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:\\Test', recursive: false, query: '^foo "bar"$', regex: true })), 'parent:"C:\\Test" <regex:"^foo \\x22bar\\x22$">');
  assert.equal(normalizeRoot('\\\\server\\share\\folder'), '\\\\server\\share\\folder');
  assert.throws(() => normalizeRoot('C:\\Test" | ext:txt'));
});

test('byte-limited pages preserve exact sizes and continue after delivered rows', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(`${i}-中文-${'x'.repeat(200)}.txt`, '9007199254740993'));
  const c = client(rows, { EVERYTHING_OUTPUT_BYTES: '4096' });
  const args = { count: 50, fields: ['size'] };
  const output = await compactSearch(c, { requests: [args] });
  const first = output.results[0];
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 4096);
  assert.ok(first.rows.length > 0 && first.rows.length < 50);
  assert.equal(first.rows[0][2], '9007199254740993');
  assert.deepEqual(first.limited_by, ['output_bytes']);
  assert.equal(first.next_offset, first.rows.length);
  const next = (await compactSearch(c, { requests: [{ ...args, offset: first.next_offset }] })).results[0];
  assert.equal(next.rows[0][0], `C:/Test/${rows[first.rows.length].name}`);
});

test('HTTP totals and folder fallback sum complete pages with exact arithmetic', async () => {
  const files = [row('a', '9007199254740993', 'C:\\Test\\folder'), row('b', '30', 'C:\\Test\\folder')];
  const c = client(query => query.includes('file:') ? files : [{ ...row('folder', null), type: 'folder' }], { EVERYTHING_MAX_RESULTS: '1' });
  assert.deepEqual(await c.search({ kind: 'file', count: 0, fields: ['size'] }),
    { total: 2, total_size_bytes: '9007199254741023', size_basis: 'indexed_logical' });
  assert.deepEqual((await c.search({ fields: ['size'] })).rows, [['C:/Test/folder', 'folder', '9007199254741023']]);
  await assert.rejects(client([row('a', null)]).search({ kind: 'file', count: 0, fields: ['size'] }), error => error.code === 'METADATA_PENDING');
});

test('a stalled HTTP response body obeys the search deadline', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"totalResults":'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(new AgentClient({ EVERYTHING_URL: 'http://127.0.0.1:' + server.address().port + '/' }).search({ timeout_ms: 100 }), error => error.code === 'TIMEOUT');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('compactSearch correctly handles output_bytes metadata at tight budget boundaries', async () => {
  const rows = [row('a'.repeat(150), '100'), row('b'.repeat(150), '100'), row('c'.repeat(150), '100')];
  // With 8 batch requests at 4096 outputBytes, budget per request is Math.floor((4096-512)/8) = 448.
  // 1 row with limited_by is ~280 bytes <= 448. 2 rows with limited_by is 453 bytes > 448.
  // Binary search must evaluate candidate with limited_by included, trimming to 1 row and succeeding.
  const tightClient = client(rows, { EVERYTHING_OUTPUT_BYTES: '4096' });
  const reqs = Array.from({ length: 8 }, () => ({ count: 3, fields: ['size'] }));
  const result = await compactSearch(tightClient, { requests: reqs });
  assert.equal(result.results.length, 8);
  for (const item of result.results) {
    assert.equal(item.rows.length, 1);
    assert.deepEqual(item.limited_by, ['output_bytes']);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 4096);
});
