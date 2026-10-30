import { spawn } from 'node:child_process';
import { AgentError } from './schema.js';

export function runProcess(executable, args, { signal, timeoutMs = 15000, maxBytes = 2097152, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AgentError('CANCELLED', 'Request cancelled', true));
    let child, timer, ended = false, size = 0;
    const chunks = [], errors = [], cleanup = new AbortController();
    const finish = (error, result) => {
      if (ended) return; ended = true; clearTimeout(timer); cleanup.abort();
      if (error) { child?.kill(); reject(error); } else resolve(result);
    };
    try { child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? {env} : {}) }); }
    catch { return finish(new AgentError('PROCESS_START_FAILED', 'Install the backend helper and check execution permissions')); }
    timer = setTimeout(() => finish(new AgentError('TIMEOUT', 'Backend helper timed out', true)), timeoutMs);
    signal?.addEventListener('abort', () => finish(new AgentError('CANCELLED', 'Request cancelled', true)), { once: true, signal: cleanup.signal });
    child.on('error', error => finish(new AgentError(error.code === 'ENOENT' ? 'HELPER_NOT_FOUND' : 'PROCESS_START_FAILED', 'Install the backend helper and check execution permissions')));
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) finish(new AgentError('RESPONSE_TOO_LARGE', 'Backend output exceeded the configured byte limit')); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { if (errors.reduce((n,b)=>n+b.length,0) < 8192) errors.push(chunk); });
    child.on('close', code => finish(null, { code, stdout: Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''), stderr: Buffer.concat(errors).toString('utf8') }));
  });
}
