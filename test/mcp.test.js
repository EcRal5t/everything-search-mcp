import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { AgentError } from '../src/schema.js';

test('MCP validates raw arguments and returns readable backend errors', async () => {
  const mockClient = {
    config: { maxResults: 1000, outputBytes: 16384 },
    search: async (request) => ({
      total: 1,
      next_offset: null,
      columns: ['path', 'type'],
      rows: [[request.query || 'file.txt', 'file']],
    }),
    status: async () => { throw new AgentError('CONNECTION_FAILED', 'Check the selected service.'); },
  };

  const server = createServer(mockClient);
  const c = new Client({ name: 'test', version: 'unreleased' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await c.connect(b);

  try {
    const tools = await c.listTools();
    const searchTool = tools.tools.find(t => t.name === 'search');
    assert.ok(searchTool);
    assert.deepEqual(Object.keys(searchTool.inputSchema.properties), ['requests']);
    assert.deepEqual(searchTool.inputSchema.required, ['requests']);

    // Rejection on unrecognized keys
    for (const args of [
      { requests: [{ rrot: 'C:/Test', count: 0 }] },
      { requests: [{ count: 0 }], typo: true },
      { typo: true, query: 'test' },
    ]) {
      const result = await c.callTool({ name: 'search', arguments: args });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unrecognized key/);
    }

    const singleResult = await c.callTool({ name: 'search', arguments: { requests: [{ query: 'test.pdf', count: 5 }] } });
    assert.ok(!singleResult.isError);
    assert.equal(singleResult.structuredContent.results[0].rows[0][0], 'test.pdf');

    // Success with batch query
    const batchResult = await c.callTool({ name: 'search', arguments: { requests: [{ query: 'batch1.txt' }, { query: 'batch2.txt' }] } });
    assert.ok(!batchResult.isError);
    const batchData = batchResult.structuredContent;
    assert.equal(batchData.results.length, 2);

    // Status error
    const result = await c.callTool({ name: 'status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'CONNECTION_FAILED');
  } finally {
    await c.close();
    await server.close();
  }
});
