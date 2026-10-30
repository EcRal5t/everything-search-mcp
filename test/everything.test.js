import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EverythingClient, configFromEnv, composeQuery, normalizeRoot, filetimeToISO } from '../src/everything.js';
import { searchSchema } from '../src/schema.js';

const config = (extra = {}) => ({ ...configFromEnv({}), validateRoots: false, ...extra });
const response = data => new Response(JSON.stringify(data));
const row = (name, size = '123', parent = 'C:\\Test') => ({ type: 'file', name, path: parent, size, date_modified: '133801632000000000' });

test('directory scope has a boundary, groups OR and supports quoted PCRE', () => {
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:/Test', query: 'foo | bar' })), 'path:"C:\\Test\\" <foo | bar>');
  assert.equal(composeQuery(searchSchema.parse({ root: 'C:\\Test', recursive: false, query: '^foo "bar"$', regex: true })), 'parent:"C:\\Test" <regex:"^foo \\x22bar\\x22$">');
  for (const value of ['C:', '\\Test', 'C:\\Test" | ext:txt', '..\\Test', '\\\\?\\C:\\Test']) assert.throws(() => normalizeRoot(value));
  assert.equal(normalizeRoot('C:\\'), 'C:\\');
  assert.equal(normalizeRoot('\\\\server\\share\\folder'), '\\\\server\\share\\folder');
});

test('search preserves Unicode and precision and sends explicit HTTP options', async () => {
  let url;
  const client = new EverythingClient(config(), async input => { url = input; return response({ totalResults: 1, results: [row('中文 & test.txt', '9007199254740993')] }); });
  const result = await client.search({ query: '中文 & test', fields: ['size', 'date_modified'] });
  assert.equal(url.searchParams.get('search'), '中文 & test');
  assert.equal(url.searchParams.get('regex'), '0');
  assert.equal(url.searchParams.get('case'), '0');
  assert.equal(result.results[0].path, 'C:\\Test\\中文 & test.txt');
  assert.equal(result.results[0].size, null);
  assert.equal(result.results[0].size_exact, '9007199254740993');
  assert.equal(result.results[0].date_modified, '2025-01-01T00:00:00.000Z');
  assert.equal(result.next_offset, null);
  assert.equal(filetimeToISO('0'), null);
  assert.equal(filetimeToISO('not-a-time'), null);
});

test('indexed drive roots are absolute and missing sizes stay unknown', async () => {
  const client = new EverythingClient(config(), async () => response({ totalResults: 2, results: [{ type: 'folder', name: 'C:', path: '', size: null }, row('x', undefined)] }));
  const result = await client.search({ fields: ['size'] });
  assert.equal(result.results[0].path, 'C:\\');
  assert.equal(result.results[0].size, null);
});

test('byte-limited pagination advances exactly by delivered results', async () => {
  const client = new EverythingClient(config({ outputBytes: 4096 }), async url => {
    const offset = Number(url.searchParams.get('offset'));
    return response({ totalResults: 60, results: Array.from({ length: Math.min(50, 60 - offset) }, (_, i) => row(`${offset + i}-${'x'.repeat(200)}.txt`)) });
  });
  const first = await client.search({ count: 50 });
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 4096);
  assert.ok(first.returned > 0 && first.returned < 50);
  assert.equal(first.next_offset, first.returned);
  assert.ok(first.limited_by.includes('output_bytes'));
  const second = await client.search({ count: 50, offset: first.next_offset });
  assert.notEqual(second.results[0].path, first.results.at(-1).path);
});

test('count requests zero rows', async () => {
  const client = new EverythingClient(config({ maxResults: 2 }), async url => {
    assert.equal(url.searchParams.get('count'), '0');
    return response({ totalResults: 999, results: [] });
  });
  assert.equal((await client.count({ query: 'ext:pdf' })).total, 999);
  assert.equal((await client.search({ count: 0 })).total, 999);
  await assert.rejects(client.search({ query: '', unexpected: true }));
});

test('invalid JSON, envelopes, overlong responses and empty pages are explicit errors', async () => {
  const examples = [
    [new Response('<html>'), 'INVALID_RESPONSE'],
    [response({ totalResults: '42', results: [] }), 'INVALID_RESPONSE'],
    [response({ totalResults: 1, results: [] }), 'INCOMPLETE_PAGE'],
    [new Response('x'.repeat(5000)), 'RESPONSE_TOO_LARGE'],
    [new Response('', { status: 503 }), 'HTTP_ERROR'],
  ];
  for (const [r, code] of examples) {
    await assert.rejects(new EverythingClient(config({ responseBytes: 4096 }), async () => r).search({}), e => e.code === code);
  }
});

test('deadline and client cancellation are distinct', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  // Keep the event loop alive while AbortSignal.timeout uses an unreferenced timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(new EverythingClient(config(), fetchImpl).search({ timeout_ms: 100 }), e => e.code === 'TIMEOUT');
    const controller = new AbortController();
    const pending = new EverythingClient(config(), fetchImpl).search({}, controller.signal);
    controller.abort();
    await assert.rejects(pending, e => e.code === 'CANCELLED');
  } finally { clearInterval(keepAlive); }
});

test('deadline also aborts a stalled real HTTP response body', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"totalResults":'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new EverythingClient(config({ url: `http://127.0.0.1:${server.address().port}/` }));
    await assert.rejects(client.search({ timeout_ms: 100 }), e => e.code === 'TIMEOUT');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('storage aggregates only scanned files, top files and marks partial scans', async () => {
  const rows = [row('a', '10', 'C:\\Test\\alpha\\sub'), row('b', '30', 'C:\\Test\\beta'), row('c', '20', 'C:\\Test\\alpha\\other')];
  const client = new EverythingClient(config({ maxResults: 2 }), async url => {
    const offset = Number(url.searchParams.get('offset')), count = Number(url.searchParams.get('count'));
    return response({ totalResults: rows.length, results: rows.slice(offset, offset + count) });
  });
  await assert.rejects(client.storage({ root: 'C:\\Test', depth: 1, max_entries: 2 }), e => e.code === 'SCAN_LIMIT');
  const partial = await client.storage({ root: 'C:\\Test', depth: 1, max_entries: 2, allow_partial: true });
  assert.equal(partial.complete, false);
  assert.equal(partial.stop_reason, 'max_entries');
  assert.equal(partial.indexed_logical_bytes, 40);
  const all = await client.storage({ root: 'C:\\Test', depth: 1 });
  assert.equal(all.complete, true);
  assert.equal(all.indexed_logical_bytes, 60);
  assert.equal(all.directories.find(g => g.path === 'C:\\Test\\alpha').indexed_logical_bytes, 30);
  assert.equal(all.largest_files[0].path, 'C:\\Test\\beta\\b');
});

test('invalid PCRE and content queries fail explicitly before touching the backend', async () => {
  const client = new EverythingClient(config(), async () => { throw Error('must not run'); });
  for (const pattern of ['([', '*.csproj']) await assert.rejects(client.search({query:pattern,regex:true}), e=>e.code==='INVALID_REGEX');
  for (const query of ['content:"word"','file: utf8content:word','notindexed:content:word','regex:"(["']) {
    await assert.rejects(client.search({query}), e=>e.code==='UNSUPPORTED_QUERY');
  }
  // PCRE-only syntax is valid; JavaScript RegExp is deliberately not the validator.
  const good = new EverythingClient(config(), async () => response({totalResults:0,results:[]}));
  assert.equal((await good.search({query:'(?P<word>abc)',regex:true})).total,0);
  assert.equal((await good.search({query:'size:>100mb'})).total,0);
});

test('root checks distinguish missing paths and non-directories', async () => {
  const client = new EverythingClient(config({validateRoots:true}), async () => { throw Error('must not run'); });
  await assert.rejects(client.search({root:'Z:\\__everything_mcp_missing_9b1d'}), e=>e.code==='ROOT_NOT_FOUND');
  if (process.platform==='win32') await assert.rejects(client.search({root:new URL('../package.json',import.meta.url).pathname.slice(1)}), e=>e.code==='ROOT_NOT_DIRECTORY');
});

test('folder sizes preserve indexed logical totals', async () => {
  const client = new EverythingClient(config(), async()=>response({totalResults:1,results:[{...row('folder','99999'),type:'folder'}]}));
  const result=await client.search({fields:['size']});
  assert.equal(result.results[0].size,99999);
  assert.equal(result.size_basis,'indexed_logical');
});
