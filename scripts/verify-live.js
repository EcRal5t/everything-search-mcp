import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.mkdir(path.join(project, '.tmp'), { recursive: true });
const root = await fs.mkdtemp(path.join(project, '.tmp', 'everything-live-'));
const samples = [['根 文件.txt', 7], ['甲 中文/小 文件.txt', 11], ['甲 中文/多层/深 文件.txt', 23], ['乙 空格/large file.txt', 101]];
const expected = samples.reduce((sum, [, size]) => sum + size, 0);
const c = new Client({ name: 'live-check', version: 'unreleased' });
const call = async (name, args = {}) => {
  const result = await c.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
};
const search = async requests => (await call('everything_search', { requests })).results;
try {
  for (const [name, size] of samples) {
    const filename = path.join(root, name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, Buffer.alloc(size, 65));
  }
  await fs.mkdir(path.join(root, '空目录'));
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(project, 'src/cli.js')], stderr: 'pipe' }));
  assert.equal(c.getServerVersion().version, 'unreleased');
  const tools = (await c.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(tools, ['everything_search', 'everything_status']);
  const status = await call('everything_status', { verbose: true });
  assert.equal(status.ready, true);
  // Wait for the live index to observe the new fixture and its size metadata.
  const deadline = Date.now() + 15000;
  let files;
  do {
    [files] = await search([{ root, kind: 'file', fields: ['size', 'date_modified'] }]);
    if (files.rows?.length === samples.length && files.rows.every(row => samples.some(([name, size]) => name === row[0] && size === row[2]))) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  assert.equal(files.total, samples.length);
  assert.deepEqual(files.rows.map(row => [row[0], row[2]]).sort(), [...samples].sort());
  assert.ok(files.rows.every(row => /^\d{4}-.*Z$/.test(row[3])));
  assert.equal(files.rows.reduce((sum, row) => sum + row[2], 0), expected);
  const [count, browse, regex, chinese, space] = await search([
    { root, kind: 'file', count: 0 }, { root, recursive: false },
    { root, query: '^小 文件\\.txt$', regex: true }, { root, query: '深' }, { root, query: '"large file"' },
  ]);
  assert.equal(count.total, samples.length);
  assert.deepEqual(browse.rows.map(row => row[0]).sort(), ['根 文件.txt', '甲 中文', '乙 空格', '空目录'].sort());
  assert.deepEqual(regex.rows.map(row => row[0]), ['甲 中文/小 文件.txt']);
  assert.deepEqual(chinese.rows.map(row => row[0]), ['甲 中文/多层/深 文件.txt']);
  assert.deepEqual(space.rows.map(row => row[0]), ['乙 空格/large file.txt']);
  const pageArgs = { root, kind: 'file', count: 2, fields: ['size'] };
  const [first] = await search([pageArgs]);
  assert.equal(first.next_offset, 2);
  const [second] = await search([{ ...pageArgs, offset: first.next_offset }]);
  assert.equal(second.next_offset, null);
  assert.deepEqual([...first.rows, ...second.rows].map(row => row[0]), files.rows.map(row => row[0]));
  const folderArgs = { root, recursive: false, kind: 'folder', fields: ['size'], sort: 'size', ascending: false };
  const [folders, single, a, b] = await search([
    folderArgs, { ...folderArgs, query: '^甲 中文$', regex: true },
    { root: path.join(root, '甲 中文'), kind: 'file', fields: ['size'] },
    { root: path.join(root, '乙 空格'), kind: 'file', fields: ['size'] },
  ]);
  assert.equal(folders.size_basis, 'indexed_logical');
  assert.deepEqual(folders.rows, [['乙 空格', 'folder', 101], ['甲 中文', 'folder', 34], ['空目录', 'folder', 0]]);
  assert.deepEqual(single.rows, [['甲 中文', 'folder', 34]]);
  assert.equal(a.rows.reduce((sum, row) => sum + row[2], 0), 34);
  assert.equal(b.rows.reduce((sum, row) => sum + row[2], 0), 101);
  const [largestFolder, nextFolder] = await search([{ ...folderArgs, count: 1 }, { ...folderArgs, count: 1, offset: 1 }]);
  assert.deepEqual(largestFolder.rows, folders.rows.slice(0, 1));
  assert.deepEqual(nextFolder.rows, folders.rows.slice(1, 2));
  const [whole, top] = await search([
    { root: path.dirname(root), recursive: false, kind: 'folder', query: '^' + path.basename(root) + '$', regex: true, fields: ['size'] },
    { root, kind: 'file', sort: 'size', ascending: false, count: 2, fields: ['size'] },
  ]);
  assert.deepEqual(whole.rows, [[path.basename(root), 'folder', expected]]);
  assert.deepEqual(top.rows.map(row => row[2]), [101, 23]);
  const badSearch = await c.callTool({ name: 'everything_search', arguments: { requests: [{ root, query: '([', regex: true }, { root: root + '-missing' }] } });
  assert.equal(badSearch.isError, true);
  assert.deepEqual(badSearch.structuredContent.results.map(result => result.error.code), ['INVALID_REGEX', 'ROOT_NOT_FOUND']);
  await c.readResource({ uri: 'everything://syntax' });
  console.log(JSON.stringify({ ok: true, transport: status.transport, instance: status.instance, version: status.version, server_version: c.getServerVersion().version, tools, sample_files: samples.length, indexed_logical_bytes: expected, folder_bytes: folders.rows, checks: ['stdio', 'unicode', 'spaces', 'nested_paths', 'file_size', 'modified_time', 'count', 'browse', 'pagination', 'regex', 'batch', 'folder_sizes', 'folder_size_sort_pagination', 'folder_total', 'largest_files', 'invalid_regex', 'missing_root', 'resource'] }));
} finally {
  await c.close();
  assert.equal(path.dirname(root), path.join(project, '.tmp'));
  await fs.rm(root, { recursive: true, force: true });
}
