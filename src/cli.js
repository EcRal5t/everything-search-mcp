#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { AgentClient } from './agent.js';
import { errorResult, AgentError, diagnosticSchema } from './schema.js';
import { compactSearch } from './compact.js';

try {
  const [command = 'mcp', ...rest] = process.argv.slice(2);
  if (command === 'mcp') {
    if (rest.length) throw new AgentError('INVALID_ARGUMENT', 'Run mcp as a standalone command');
    await (await import('./server.js')).startServer();
  } else {
    let raw = '{}';
    if (rest[0] === '--input' && rest.length === 2) raw = await readFile(rest[1], 'utf8');
    else if (rest[0] === '--stdin' && rest.length === 1) {
      const chunks = []; let bytes = 0;
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > 1048576) throw new AgentError('INVALID_ARGUMENT', 'stdin exceeds 1 MiB');
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } else if (rest.length === 1) raw = rest[0];
    else if (rest.length) throw new AgentError('INVALID_ARGUMENT', 'Use JSON, --input file.json or --stdin.');
    let args;
    try { args = JSON.parse(raw.replace(/^\uFEFF/, '')); }
    catch { throw new AgentError('INVALID_ARGUMENT', 'Input must be valid JSON'); }
    const client = new AgentClient();
    let result;
    if (command === 'search') result = await compactSearch(client, args);
    else if (command === 'doctor') { diagnosticSchema.parse(args); result = await client.status(undefined, true); }
    else if (command === 'help') result = { commands: ['mcp', 'doctor', 'search'], input: 'JSON | --input file.json | --stdin', example: { requests: [{ query: 'ext:pdf', count: 10 }] } };
    else throw new AgentError('INVALID_ARGUMENT', `Choose mcp, doctor or search; received ${command}.`);
    console.log(JSON.stringify(result));
    if (result.ready === false || result.results?.every(item => item.error)) process.exitCode = 1;
  }
} catch (error) { console.log(JSON.stringify(errorResult(error))); process.exitCode = 1; }
