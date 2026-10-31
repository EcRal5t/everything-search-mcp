import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentClient } from '../src/agent.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = path.join(project, '.tmp');
await fs.mkdir(temporary, { recursive: true });
const root = await fs.mkdtemp(path.join(temporary, 'everything-live-'));
const samples = [['根 文件.txt', 7], ['甲 中文/小 文件.txt', 11], ['甲 中文/多层/深 文件.txt', 23], ['乙 空格/large file.txt', 101]];
const c = new Client({ name: 'live-check', version: 'unreleased' });
const call = async (name, args = {}) => {
  const result = await c.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
};
const search = async requests => (await call('search', { requests })).results;
try {
  for (const [name, size] of samples) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), Buffer.alloc(size, 65));
  }
  await fs.mkdir(path.join(root, '空目录'));
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(project, 'src/cli.js')], env: process.env, stderr: 'pipe' }));
  assert.deepEqual((await c.listTools()).tools.map(tool => tool.name).sort(), ['search', 'status']);
  const status = await call('status');
  const requests = [
    { root, kind: 'file', fields: ['size', 'date_modified'] },
    { root, recursive: false, kind: 'folder', fields: ['size'], sort: 'size', ascending: false },
    { root, kind: 'file', count: 0, fields: ['size'] },
    { root, kind: 'file', query: '^深 文件\\.txt$', regex: true },
  ];
  const deadline = Date.now() + 15000;
  let files;
  do {
    [files] = await search([requests[0]]);
    if (files.rows?.length === samples.length && files.rows.every(row => samples.some(([name, size]) => name === row[0] && size === row[2]))) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  const results = await search(requests), [all, folders, sum, regex] = results;
  assert.deepEqual(all.rows.map(row => [row[0], row[2]]).sort(), [...samples].sort());
  assert.ok(all.rows.every(row => /^\d{4}-.*Z$/.test(row[3])));
  assert.deepEqual(folders.rows, [['乙 空格', 'folder', 101], ['甲 中文', 'folder', 34], ['空目录', 'folder', 0]]);
  assert.deepEqual(sum, { total: 4, total_size_bytes: 142, size_basis: 'indexed_logical' });
  assert.deepEqual(regex.rows, [['甲 中文/多层/深 文件.txt', 'file']]);
  const page = { ...requests[0], count: 2 };
  const [first] = await search([page]);
  const [second, count, empty, top] = await search([
    { ...page, offset: first.next_offset }, { root, kind: 'file', count: 0 },
    { ...requests[2], root: path.join(root, '空目录') }, { ...requests[0], sort: 'size', ascending: false, count: 1 },
  ]);
  assert.deepEqual([...first.rows, ...second.rows], all.rows);
  assert.equal(second.next_offset, null);
  assert.deepEqual(count, { total: 4 });
  assert.equal(empty.total_size_bytes, 0);
  assert.equal(top.rows[0][2], 101);
  if (status.transport === 'ipc') {
    const [metadata] = await search([{ root, kind: 'file', sort: 'date_created', count: 1, fields: ['date_created', 'date_accessed', 'attributes', 'run_count'] }]);
    assert.ok(metadata.rows[0].slice(2, 4).every(value => /^\d{4}-.*Z$/.test(value)));
    assert.ok(Number.isInteger(metadata.rows[0][4]));
    assert.equal(metadata.rows[0][5], 0);
  }
  const bad = await c.callTool({ name: 'search', arguments: { requests: [{ root, query: 'content:test' }, { root: root + '-missing' }] } });
  assert.equal(bad.isError, true);
  assert.deepEqual(bad.structuredContent.results.map(result => result.error.code), ['UNSUPPORTED_QUERY', 'ROOT_NOT_FOUND']);
  await c.readResource({ uri: 'everything://syntax' });
  const httpUrl = process.env.EVERYTHING_TEST_HTTP_URL;
  if (httpUrl) {
    assert.equal(status.transport, 'ipc', 'Use the IPC backend for the HTTP comparison.');
    const http = new AgentClient({ ...process.env, EVERYTHING_URL: httpUrl });
    for (let i = 0; i < requests.length; i++) assert.deepEqual(await http.search(requests[i]), results[i]);
  }
  console.log(JSON.stringify({ ok: true, transport: status.transport, instance: status.instance, version: status.version, sample_files: 4, total_size_bytes: 142, http_parity: Boolean(httpUrl) }));
} finally {
  await c.close();
  assert.equal(path.dirname(root), temporary);
  await fs.rm(root, { recursive: true, force: true });
}
