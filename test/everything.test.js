import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AgentClient } from '../src/agent.js';
import { composeQuery, normalizeRoot, filetimeToISO } from '../src/everything.js';
import { compactSearch } from '../src/compact.js';
import { searchSchema } from '../src/schema.js';
import { validateQuery } from '../src/validation.js';

const response = data => new Response(JSON.stringify(data));
const client = (fetch, env = {}) => new AgentClient({ EVERYTHING_URL: 'http://example.test/', ...env }, { fetch });
const row = (name, size = '123', parent = 'C:\\Test') => ({ type: 'file', name, path: parent, size, date_modified: '133801632000000000' });
const page = (rows, url) => response({ totalResults: rows.length, results: rows.slice(Number(url.searchParams.get('offset')), Number(url.searchParams.get('offset')) + Number(url.searchParams.get('count'))) });

test('directory scope has a boundary, groups OR and supports quoted PCRE', () => {
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:/Test', query: 'foo | bar' })), 'path:"C:\\Test\\" <foo | bar>');
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:\\Test', recursive: false, query: '^foo "bar"$', regex: true })), 'parent:"C:\\Test" <regex:"^foo \\x22bar\\x22$">');
  for (const value of ['C:', '\\Test', 'C:\\Test" | ext:txt', '..\\Test', '\\\\?\\C:\\Test']) assert.throws(() => normalizeRoot(value));
  assert.equal(normalizeRoot('C:\\'), 'C:\\');
  assert.equal(normalizeRoot('\\\\server\\share\\folder'), '\\\\server\\share\\folder');
});

test('search preserves Unicode and exact sizes in the final table', async () => {
  let url;
  const c = client(async input => { url = input; return page([row('中文 & test.txt', '9007199254740993')], input); });
  const result = await c.search({ query: '中文 & test', fields: ['size', 'date_modified'] });
  assert.equal(url.searchParams.get('search'), '中文 & test');
  assert.equal(url.searchParams.get('regex'), '0');
  assert.equal(url.searchParams.get('case'), '0');
  assert.deepEqual(result.rows, [['C:/Test/中文 & test.txt', 'file', '9007199254740993', '2025-01-01T00:00:00.000Z']]);
  assert.equal(result.next_offset, null);
  assert.equal(filetimeToISO('0'), null);
  assert.equal(filetimeToISO('not-a-time'), null);
});

test('drive roots stay absolute and unknown sizes stay null', async () => {
  const c = client(async url => page([{ type: 'folder', name: 'C:', path: '', size: '42' }, { ...row('x'), size: null }], url));
  const result = await c.search({ fields: ['size'] });
  assert.deepEqual(result.rows, [['C:/', 'folder', 42], ['C:/Test/x', 'file', null]]);
});

test('output clipping advances pagination by the delivered rows', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(i + '-' + 'x'.repeat(200) + '.txt'));
  const c = client(async url => page(rows, url), { EVERYTHING_OUTPUT_BYTES: '4096' });
  const output = await compactSearch(c, { requests: [{ count: 50 }] });
  const first = output.results[0];
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 4096);
  assert.ok(first.rows.length > 0 && first.rows.length < 50);
  assert.equal(first.next_offset, first.rows.length);
  assert.ok(first.limited_by.includes('output_bytes'));
  const second = (await compactSearch(c, { requests: [{ count: 50, offset: first.next_offset }] })).results[0];
  assert.notEqual(second.rows[0][0], first.rows.at(-1)[0]);
});

test('count requests zero rows and keeps a selected connection', async () => {
  let calls = 0;
  const c = client(async url => { calls++; assert.equal(url.searchParams.get('count'), '0'); return response({ totalResults: 999, results: [] }); });
  assert.deepEqual(await c.search({ query: 'ext:pdf', count: 0 }), { total: 999 });
  assert.deepEqual(await c.search({ count: 0 }), { total: 999 });
  assert.equal(calls, 2);
  await assert.rejects(c.search({ query: '', unexpected: true }));
});

test('count with file sizes sums the complete query across HTTP pages', async () => {
  const rows = [row('a', '9007199254740993'), row('b', '30'), row('c', '20')];
  const seen = [];
  const c = client(async url => {
    seen.push(url.searchParams.get('search'));
    return page(url.searchParams.get('search').includes('absent') ? [] : rows, url);
  }, { EVERYTHING_MAX_RESULTS: '2' });
  assert.deepEqual(await c.search({ kind: 'file', query: 'ext:log', count: 0, fields: ['size'], offset: 99 }),
    { total: 3, total_size_bytes: '9007199254741043', size_basis: 'indexed_logical' });
  assert.ok(seen.every(query => query === 'file: <ext:log>'));
  assert.deepEqual(await c.search({ kind: 'file', query: 'absent', count: 0, fields: ['size'] }),
    { total: 0, total_size_bytes: 0, size_basis: 'indexed_logical' });
  await assert.rejects(c.search({ kind: 'folder', count: 0, fields: ['size'] }), error => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(c.search({ sort: 'extension' }), error => error.code === 'UNSUPPORTED_QUERY');
  await assert.rejects(c.search({ fields: ['date_created'] }), error => error.code === 'UNSUPPORTED_METADATA');
});

test('invalid responses and empty pages produce explicit errors', async () => {
  for (const [value, code] of [
    ['<html>', 'INVALID_RESPONSE'], [JSON.stringify({ totalResults: '42', results: [] }), 'INVALID_RESPONSE'],
    ['x'.repeat(5000), 'RESPONSE_TOO_LARGE'],
  ]) {
    await assert.rejects(client(async () => new Response(value), { EVERYTHING_RESPONSE_BYTES: '4096' }).search({}), error => error.code === code);
  }
  const empty = client(async () => response({ totalResults: 1, results: [] }));
  await assert.rejects(empty.search({}), error => error.code === 'INCOMPLETE_PAGE');
  await assert.rejects(client(async () => new Response('', { status: 503 })).search({}), error => error.code === 'HTTP_ERROR');
});

test('deadline and client cancellation remain distinct', async () => {
  const stalled = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(client(stalled).search({ timeout_ms: 100 }), error => error.code === 'TIMEOUT');
    const controller = new AbortController();
    const pending = client(stalled).search({}, controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error.code === 'CANCELLED');
  } finally { clearInterval(keepAlive); }
});

test('a stalled real HTTP response body reaches its deadline', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"totalResults":'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(new AgentClient({ EVERYTHING_URL: 'http://127.0.0.1:' + server.address().port + '/' }).search({ timeout_ms: 100 }), error => error.code === 'TIMEOUT');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('invalid PCRE and content queries fail before connecting', async () => {
  const c = client(async () => { throw Error('Backend should remain unused'); });
  for (const pattern of ['([', '*.csproj']) await assert.rejects(c.search({ query: pattern, regex: true }), error => error.code === 'INVALID_REGEX');
  for (const query of ['content:"word"', 'file: utf8content:word', 'notindexed:content:word', 'regex:"(["']) await assert.rejects(c.search({ query }), error => error.code === 'UNSUPPORTED_QUERY');
  const good = client(async url => page([], url));
  assert.equal((await good.search({ query: '(?P<word>abc)', regex: true })).total, 0);
  assert.equal((await good.search({ query: 'size:>100mb' })).total, 0);
  assert.deepEqual(await validateQuery({ query: '"content:literal" <ext:js | ext:ts>' }), ['ext', 'ext']);
});

test('root checks distinguish missing directories and files', async () => {
  const c = client(async url => page([], url), { EVERYTHING_URL: 'http://127.0.0.1/' });
  await assert.rejects(c.search({ root: 'Z:\\__everything_mcp_missing_9b1d' }), error => error.code === 'ROOT_NOT_FOUND');
  if (process.platform === 'win32') await assert.rejects(c.search({ root: new URL('../package.json', import.meta.url).pathname.slice(1) }), error => error.code === 'ROOT_NOT_DIRECTORY');
});

test('HTTP folder fallback sums indexed files across pages', async () => {
  for (const size of [null, '', '0']) {
    const c = client(async url => page(url.searchParams.get('search').includes('file:') ?
      [row('a', '10', 'C:\\Test\\folder'), row('b', '30', 'C:\\Test\\folder\\deep'), row('c', '20', 'C:\\Test\\folder')] :
      [{ ...row('folder', size), type: 'folder' }], url), { EVERYTHING_MAX_RESULTS: '2' });
    const result = await c.search({ root: 'C:\\Test', fields: ['size'] });
    assert.deepEqual(result.rows, [['folder', 'folder', 60]]);
    assert.equal(result.size_basis, 'indexed_logical');
  }
});

test('HTTP folder fallback preserves pending metadata and path boundaries', async () => {
  for (const [files, code] of [
    [[{ ...row('x', '1', 'C:\\Test\\other') }], 'INVALID_RESPONSE'],
    [[{ ...row('x', '1', 'C:\\Test\\folder'), size: null }], 'METADATA_PENDING'],
  ]) {
    const c = client(async url => page(url.searchParams.get('search').includes('file:') ? files : [{ ...row('folder', '0'), type: 'folder' }], url));
    await assert.rejects(c.search({ fields: ['size'] }), error => error.code === code);
  }
});

test('IPC selection stays pinned and preserves version-specific folder sizes', async () => {
 for (const version of ['1.4.1.1024', '1.5.0.1409']) {
  let discoveries = 0, sums = 0;
  const c = new AgentClient({}, {
    inspect: async () => ({ instances: [''] }),
    discoverIpc: async () => {
      discoveries++;
      return { info: { transport: 'ipc', instance: '', version, local: false }, transport: {
        request: async () => ({ totalResults: 1, results: [{ ...row('folder', '0'), type: 'folder' }] }),
        directorySize: async () => { sums++; return '34'; },
      } };
    },
  });
  assert.deepEqual((await c.search({ fields: ['size'] })).rows, [['C:/Test/folder', 'folder', version.startsWith('1.4.') ? 34 : 0]]);
  await c.search({});
  assert.equal(discoveries, 1);
  assert.equal(sums, version.startsWith('1.4.') ? 1 : 0);
 }
});
