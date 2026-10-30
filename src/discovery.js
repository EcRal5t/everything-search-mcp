import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runProcess } from './process.js';
import { AgentError } from './schema.js';
import { IpcTransport } from './ipc.js';

const project = fileURLToPath(new URL('../', import.meta.url));
export const exists = filename => access(filename).then(()=>true,()=>false);
export function parseINI(text) {
  const sections = {}; let current = sections[''] = {};
  for (const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if (/^\s*[;#]/.test(line)) continue;
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) current = sections[section[1].toLowerCase()] ??= {};
    else { const entry = line.match(/^\s*([^=]+?)\s*=(.*)$/); if (entry) current[entry[1].trim().toLowerCase()] = entry[2].trim(); }
  }
  return sections;
}
export async function inspectWindows(env = process.env, signal) {
  if (process.platform !== 'win32') return {instances:[], directories:[]};
  const ps = path.join(env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const r = await runProcess(ps, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(project,'scripts','discover.ps1')], {signal,timeoutMs:8000,maxBytes:65536});
  if (r.code !== 0) throw new AgentError('DISCOVERY_FAILED', 'Windows instance discovery failed', true, 'Specify EVERYTHING_INSTANCE and/or EVERYTHING_URL explicitly.');
  try { return JSON.parse(r.stdout); } catch { throw new AgentError('DISCOVERY_FAILED','Invalid Windows discovery response'); }
}
export async function findHttp(discovery, env = process.env) {
  const endpoints = [];
  const dirs = [...(discovery.directories ?? []), ...(env.APPDATA ? [path.join(env.APPDATA,'Everything')] : [])];
  for (const dir of new Set(dirs)) for (const instance of new Set([...(discovery.instances ?? []),'','1.5a','1.5'])) {
    if (env.EVERYTHING_INSTANCE !== undefined && instance !== env.EVERYTHING_INSTANCE) continue;
    const suffix = instance ? `-${instance}` : '';
    let main = {}, plugins = {};
    try { main = parseINI(await readFile(path.join(dir,`Everything${suffix}.ini`),'utf8')).everything ?? {}; } catch {}
    try { plugins = parseINI(await readFile(path.join(dir,`Plugins${suffix}.ini`),'utf8')); } catch {}
    const names = (main.plugin_filename || '').split(','), flags = (main.plugin_enabled || '').split(',');
    for (const [name, settings] of Object.entries(plugins)) {
      if (!/^http_server(?:32|64|arm|arm64)\.dll$/i.test(name) || settings.enabled !== '1') continue;
      const index = names.findIndex(n => path.win32.basename(n).toLowerCase() === name);
      if (index >= 0 && flags[index] === '0') continue;
      const port = Number(settings.port || 80);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      // Read explicit authentication settings from the environment.
      endpoints.push({url:`http://127.0.0.1:${port}/`,instance,source:path.join(dir,`Plugins${suffix}.ini`)});
    }
    if (main.http_server_enabled === '1') {
      const port = Number(main.http_server_port || 80);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) endpoints.push({url:`http://127.0.0.1:${port}/`,instance,source:path.join(dir,`Everything${suffix}.ini`)});
    }
  }
  return endpoints.filter((v,i,a)=>a.findIndex(x=>x.url===v.url && x.instance===v.instance)===i);
}
export async function discoverIpc(discovery, config, env = process.env, signal, factory = options => new IpcTransport(options)) {
  const arch = {x64:'x64',ia32:'x86',arm64:'ARM64',arm:'ARM'}[process.arch];
  const executable = env.EVERYTHING_ES_PATH || path.join(project,'vendor','es',arch || process.arch,'es.exe');
  if (!await exists(executable)) throw new AgentError('HELPER_NOT_FOUND','The bundled ES helper is missing for this architecture',false,'Reinstall the package, or set EVERYTHING_ES_PATH to ES 1.1.0.38 or newer.');
  const explicit = env.EVERYTHING_INSTANCE !== undefined;
  const instances = explicit ? [env.EVERYTHING_INSTANCE] : [...new Set([...(discovery.instances ?? []),'','1.5a','1.5'])];
  const candidates = [];
  for (const instance of instances) {
    if (signal?.aborted) throw new AgentError('CANCELLED','Request cancelled',true);
    const transport = factory({executable,instance,timeoutMs:config.timeoutMs,responseBytes:config.responseBytes});
    try {
      const version = await transport.getVersion(signal);
      const [major,minor,revision] = version.split('.').map(Number);
      if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && revision < 1)))) throw new AgentError('UNSUPPORTED_VERSION','Everything 1.4.1 or newer is required');
      // This query waits for the database; locating a tray window alone is insufficient.
      await transport.request({timeout_ms:2500},0,'',signal);
      candidates.push({transport,info:{transport:'ipc',instance,version,local:true}});
    } catch(error) { if (error.code === 'CANCELLED') throw error; if (explicit) throw error; }
  }
  if (candidates.length > 1) throw new AgentError('MULTIPLE_INSTANCES',`Multiple running indexes are available: ${candidates.map(c=>JSON.stringify(c.info.instance)).join(', ')}`,false,'Set EVERYTHING_INSTANCE once to select the intended index.');
  if (!candidates.length) throw new AgentError('INSTANCE_NOT_FOUND','Start a reachable Everything client and wait for index readiness',true,'Start Everything, wait for indexing, then run everything-agent doctor.');
  return candidates[0];
}
