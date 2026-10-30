import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { AgentClient } from '../src/agent.js';
import { AgentError } from '../src/schema.js';

const backend = () => new AgentClient({ EVERYTHING_URL: 'http://example.test/' }, {
  fetch: async url => new Response(JSON.stringify({ totalResults: 1, results: url.searchParams.get('count') === '0' ? [] : [{ type: 'file', name: 'x.txt', path: 'C:\\Test' }] })),
});
async function connect(server) {
  const client = new Client({ name: 'test', version: 'unreleased' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return client;
}
test('two read-only tools, typed results, batch errors and syntax resource', async () => {
  const server = createServer(backend()), c = await connect(server);
  try {
    const tools = (await c.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['everything_search', 'everything_status']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint && tool.outputSchema));
    assert.equal(c.getServerVersion().version, 'unreleased');
    const result = await c.callTool({ name: 'everything_search', arguments: { requests: [{ root: 'C:\\Test' }, { query: 'content:word' }] } });
    assert.ok(!result.isError);
    assert.equal(result.structuredContent.results[0].base, 'C:/Test');
    assert.deepEqual(result.structuredContent.results[0].rows, [['x.txt', 'file']]);
    assert.equal(result.structuredContent.results[1].error.code, 'UNSUPPORTED_QUERY');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    const bad = await c.callTool({ name: 'everything_search', arguments: { requests: [{ root: 'relative' }] } });
    assert.equal(bad.isError, true);
    assert.equal(bad.structuredContent.results[0].error.code, 'INVALID_ARGUMENT');
    const count = await c.callTool({ name: 'everything_search', arguments: { requests: [{ count: 0 }] } });
    assert.deepEqual(count.structuredContent, { results: [{ total: 1 }] });
    assert.ok(JSON.parse((await c.readResource({ uri: 'everything://syntax' })).contents[0].text).examples.length);
  } finally { await c.close(); await server.close(); }
});
test('configuration errors remain discoverable through status', async () => {
  const server = createServer(new AgentClient({ EVERYTHING_URL: 'file:///bad' })), c = await connect(server);
  try {
    assert.equal((await c.listTools()).tools.length, 2);
    const result = await c.callTool({ name: 'everything_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.problems[0].code, 'INVALID_CONFIG');
  } finally { await c.close(); await server.close(); }
});
test('thrown errors remain readable after output schema discovery', async () => {
  const client = backend();
  client.status = async () => { throw new AgentError('CONNECTION_FAILED', 'Check the selected service.'); };
  const server = createServer(client), c = await connect(server);
  try {
    await c.listTools();
    const result = await c.callTool({ name: 'everything_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'CONNECTION_FAILED');
  } finally { await c.close(); await server.close(); }
});
