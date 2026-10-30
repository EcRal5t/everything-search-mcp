import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const skillSource = path.join(project, '.agents', 'skills', 'everything-search');
const tomlString = value => JSON.stringify(value);
const block = `\n[mcp_servers.everything]\ncommand = "node"\nargs = [${tomlString(path.join(project, 'src', 'server.js'))}]\nstartup_timeout_sec = 15\ntool_timeout_sec = 130\n\n`;
const messages = [];

async function readOrEmpty(filename) {
  try { return await fs.readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function installConfig(directory, scope) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'config.toml');
  const previous = await readOrEmpty(filename);
  if (/^\s*\[mcp_servers\.(?:everything|"everything")\]\s*$/m.test(previous)) {
    messages.push({ scope, config: filename, state: 'existing_entry_preserved', message: 'An existing everything server entry was preserved; check its command before use.' });
    return false;
  }
  const staged = path.join(directory, `.everything-${randomUUID()}.tmp`);
  try {
    // Stage the complete replacement before updating the configuration.
    await fs.writeFile(staged, previous + block, { flag: 'wx', mode: 0o600 });
    if (await readOrEmpty(filename) !== previous) throw new Error('Config changed during installation; retry to avoid overwriting another edit.');
    if (previous) {
      const backups = path.join(project, 'installation-backups');
      await fs.mkdir(backups, { recursive: true });
      await fs.writeFile(path.join(backups, `${scope}-config-${Date.now()}.toml`), previous, { flag: 'wx', mode: 0o600 });
    }
    await fs.rename(staged, filename);
    messages.push({ scope, config: filename, state: 'installed' });
    return true;
  } finally { await fs.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

try {
  const mcp = { mcpServers: { everything: { command: 'node', args: [path.join(project, 'src/server.js')] } } };
  const mcpPath = path.join(project, '.mcp.json');
  const existingMcp = await readOrEmpty(mcpPath);
  if (!existingMcp) await fs.writeFile(mcpPath, JSON.stringify(mcp, null, 2) + '\n', { flag: 'wx' });
  else messages.push({ scope: 'portable', config: mcpPath, state: 'existing_file_preserved' });

  const projectConfig = path.join(project, '.codex', 'config.toml');
  let globalAvailable = false;
  try {
    globalAvailable = await installConfig(codexHome, 'global');
    if (!globalAvailable) {
      const existing = await readOrEmpty(path.join(codexHome, 'config.toml'));
      globalAvailable = existing.includes(tomlString(path.join(project, 'src', 'server.js')));
    }
  } catch (error) {
    messages.push({ scope: 'global', state: 'blocked', code: error.code ?? 'INSTALL_FAILED', message: error.code === 'ENOSPC' ? 'Codex home drive is full. Existing config was preserved. Rerun after freeing space.' : 'Existing configuration preserved; use the project configuration and check Codex home permissions.' });
  }
  if (globalAvailable) {
    // Remove only our exact previously generated fallback, avoiding duplicate server definitions.
    const fallback = await readOrEmpty(projectConfig);
    if (fallback === block) await fs.unlink(projectConfig);
  } else await installConfig(path.join(project, '.codex'), 'project');

  const destination = path.join(codexHome, 'skills', 'everything-search');
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      const resolved = await fs.realpath(destination);
      messages.push({ scope: 'skill', state: resolved.toLowerCase() === skillSource.toLowerCase() ? 'already_installed' : 'existing_skill_preserved', path: destination });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Link the installed skill to the project copy.
      await fs.symlink(skillSource, destination, process.platform === 'win32' ? 'junction' : 'dir');
      messages.push({ scope: 'skill', state: 'installed', path: destination });
    }
  } catch (error) { messages.push({ scope: 'skill', state: 'blocked', code: error.code ?? 'INSTALL_FAILED', message: 'Project skill remains available. Rerun installation after freeing profile-drive space.' }); }
  console.log(JSON.stringify({ ok: true, project, global_mcp_available: globalAvailable, messages, next_step: 'Create a new Codex chat or reload MCP connections to discover the server/skill. CLI is usable immediately.' }));
} catch (error) { console.error(JSON.stringify({ ok: false, code: error.code ?? 'INSTALL_FAILED', message: 'Inspect local configuration files and retry setup.' })); process.exitCode = 1; }
