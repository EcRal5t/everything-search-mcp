import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { AgentError } from '../src/schema.js';

test('MCP validates raw arguments and returns readable backend errors', async () => {
  const server = createServer({ status: async () => { throw new AgentError('CONNECTION_FAILED', 'Check the selected service.'); } });
  const c = new Client({ name: 'test', version: 'unreleased' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await c.connect(b);
  try {
    await c.listTools();
    for (const args of [{ requests: [{ rrot: 'C:/Test', count: 0 }] }, { requests: [{ count: 0 }], typo: true }]) {
      const result = await c.callTool({ name: 'everything_search', arguments: args });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unrecognized key/);
    }
    const result = await c.callTool({ name: 'everything_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'CONNECTION_FAILED');
  } finally { await c.close(); await server.close(); }
});
