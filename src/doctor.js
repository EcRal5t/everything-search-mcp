import path from 'node:path';
import { spawn } from 'node:child_process';
import { inspectWindows, exists } from './discovery.js';
import { AgentError } from './schema.js';

export async function repair(client) {
  const status = await client.status(undefined,true);
  if (status.ready) return {...status,actions:[]};
  if (process.platform !== 'win32') return status;
  const inventory = await inspectWindows(client.env);
  const candidates = client.env.EVERYTHING_EXE_PATH ? [client.env.EVERYTHING_EXE_PATH]
    : [...new Set([...(inventory.directories ?? []),path.join(process.env.ProgramFiles || 'C:\\Program Files','Everything')])].map(dir=>path.join(dir,'Everything.exe'));
  const installed = [];
  for (const filename of candidates) if (await exists(filename)) installed.push(filename);
  if (installed.length !== 1) throw new AgentError('INSTALLATION_SELECTION', 'Choose the Everything executable with EVERYTHING_EXE_PATH.',false,'Use the path to the installed Everything.exe.');
  if (!['INSTANCE_NOT_FOUND','BACKEND_UNAVAILABLE'].includes(status.problems[0]?.code)) return status;
  const args = ['-startup',...(client.env.EVERYTHING_INSTANCE ? ['-instance',client.env.EVERYTHING_INSTANCE] : [])];
  const child = spawn(installed[0],args,{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new AgentError('START_FAILED','Start the selected Everything application and rerun doctor.')));});
  child.unref();
  for (let i=0;i<3;i++) {
    await new Promise(resolve=>setTimeout(resolve,500));
    const updated = await client.status(undefined,true);
    if (updated.ready) return {...updated,actions:['started_everything']};
  }
  return {...await client.status(undefined,true),actions:['started_everything']};
}
