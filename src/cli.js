#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { AgentClient } from './agent.js';
import { emptySchema, errorResult, AgentError, mcpStorageSchema } from './schema.js';
import { compactSearch, compactStorage } from './compact.js';

try {
  const [command = 'mcp', ...rest] = process.argv.slice(2);
  if (command === 'mcp') {
    if (rest.length) throw new AgentError('INVALID_ARGUMENT','Run mcp as a standalone command');
    const {createServer} = await import('./server.js');
    const {StdioServerTransport} = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await createServer().connect(new StdioServerTransport());
  } else {
    if (command === 'setup') { await import('../scripts/install-codex.js'); }
    else {
    let raw = '{}';
    const fix = command === 'doctor' && rest.length === 1 && rest[0] === '--fix';
    if (fix) raw = '{}';
    else if (rest[0] === '--input' && rest.length === 2) raw = await readFile(rest[1], 'utf8');
    else if (rest[0] === '--stdin' && rest.length === 1) {
      const chunks = []; let bytes = 0;
      for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 1048576) throw new AgentError('INVALID_ARGUMENT', 'stdin exceeds 1 MiB'); chunks.push(chunk); }
      raw = Buffer.concat(chunks).toString('utf8');
    } else if (rest.length === 1) raw = rest[0];
    else if (rest.length) throw new AgentError('INVALID_ARGUMENT', 'Use JSON, --input file.json or --stdin. doctor is read-only.');
    let args;
    try { args = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new AgentError('INVALID_ARGUMENT', 'Input must be valid JSON'); }
    const client = new AgentClient();
    let result;
    switch (command) {
      case 'search': result = await compactSearch(client,args); break;
      case 'doctor': result = fix ? await (await import('./doctor.js')).repair(client) : await client.status(undefined,true); break;
      case 'storage': result = compactStorage(await client.storage(mcpStorageSchema.parse(args))); break;
      case 'help': emptySchema.parse(args); result = { commands:['mcp','doctor','setup','search','storage'],input:'JSON | --input file.json | --stdin',example:{requests:[{query:'ext:pdf',count:10}]} }; break;
      default: throw new AgentError('INVALID_ARGUMENT', `Unknown command: ${command}`);
    }
    console.log(JSON.stringify(result));
    if (result.ok === false || result.ready === false || result.results?.every(r=>r.error)) process.exitCode = 1;
    }
  }
} catch (error) { console.log(JSON.stringify(errorResult(error))); process.exitCode = 1; }
