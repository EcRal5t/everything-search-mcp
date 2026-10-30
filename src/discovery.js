import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runProcess } from './process.js';
import { AgentError } from './schema.js';
import { IpcTransport } from './ipc.js';

const project = fileURLToPath(new URL('../', import.meta.url));
export async function inspectWindows(env = process.env, signal) {
  if (process.platform !== 'win32') throw new AgentError('PLATFORM_SELECTION', 'Use Windows for local IPC, or configure EVERYTHING_URL.');
  const ps = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await runProcess(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'scripts/discover.ps1')], { signal, timeoutMs: 8000, maxBytes: 65536 });
  if (result.code !== 0) throw new AgentError('DISCOVERY_FAILED', 'Specify EVERYTHING_INSTANCE to select a running index.', true);
  try { return JSON.parse(result.stdout); }
  catch { throw new AgentError('DISCOVERY_FAILED', 'Expected a Windows instance inventory'); }
}
export async function discoverIpc(discovery, config, env = process.env, signal, factory = options => new IpcTransport(options)) {
  const arch = { x64: 'x64', ia32: 'x86', arm64: 'ARM64', arm: 'ARM' }[process.arch];
  const executable = env.EVERYTHING_ES_PATH || path.join(project, 'vendor', 'es', arch || process.arch, 'es.exe');
  try { await access(executable); }
  catch { throw new AgentError('HELPER_NOT_FOUND', 'Install the bundled ES helper, or set EVERYTHING_ES_PATH to ES 1.1.0.38 or newer.'); }
  const explicit = env.EVERYTHING_INSTANCE !== undefined;
  const instances = explicit ? [env.EVERYTHING_INSTANCE] : [...new Set([...(discovery.instances ?? []), '', '1.5a', '1.5'])];
  const candidates = [];
  for (const instance of instances) {
    if (signal?.aborted) throw new AgentError('CANCELLED', 'Request cancelled', true);
    const transport = factory({ executable, instance, timeoutMs: config.timeoutMs, responseBytes: config.responseBytes });
    try {
      const version = await transport.getVersion(signal);
      const [major, minor, revision] = version.split('.').map(Number);
      if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && revision < 1)))) throw new AgentError('UNSUPPORTED_VERSION', 'Everything 1.4.1 or newer is required');
      await transport.request({ timeout_ms: 2500 }, 0, '', signal);
      candidates.push({ transport, info: { transport: 'ipc', instance, version, local: true } });
    } catch (error) { if (signal?.aborted || error.code === 'CANCELLED' || explicit) throw error; }
  }
  if (candidates.length > 1) throw new AgentError('MULTIPLE_INSTANCES', 'Available indexes: ' + candidates.map(candidate => JSON.stringify(candidate.info.instance)).join(', '), false, 'Set EVERYTHING_INSTANCE to select the intended index.');
  if (!candidates.length) throw new AgentError('INSTANCE_NOT_FOUND', 'Start Everything and wait for index readiness, then run doctor.', true);
  return candidates[0];
}
