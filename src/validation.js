import { stat } from 'node:fs/promises';
import { AgentError } from './schema.js';

// Preserve quoted filename literals while identifying query functions.
export function queryFunctions(query) {
  const plain = query.replace(/"[^"]*"/g, ' ');
  return [...plain.matchAll(/(?<![a-z0-9_-])\$?([a-z][a-z0-9_-]*):/gi)].map(match => match[1].toLowerCase());
}

export async function validateQuery(input) {
  if (input.regex) return [];
  const functions = queryFunctions(input.query);
  for (const fn of functions) {
    if (/content$/.test(fn) || ['include-filelist', 'include', 'filter', 'macro'].includes(fn)) {
      throw new AgentError('UNSUPPORTED_QUERY', `Query function '${fn}:' is not supported in file path searches.`);
    }
    if (fn === 'regex') throw new AgentError('UNSUPPORTED_QUERY', 'Set regex:true and place the pattern in query.');
    if (['sort', 'count', 'offset', 'distinct', 'unique'].includes(fn)) {
      throw new AgentError('UNSUPPORTED_QUERY', `Query function '${fn}:' alters result semantics; use corresponding request parameters instead.`);
    }
  }
  return functions;
}

export async function validateRoot(root, timeoutMs = 3000, signal) {
  let timer;
  const cleanup = new AbortController();
  try {
    const info = await Promise.race([
      stat(root),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new AgentError('ROOT_CHECK_TIMEOUT', 'Root accessibility check timed out', true)), timeoutMs); }),
      ...(signal ? [new Promise((_, reject) => {
        if (signal.aborted) reject(new AgentError('CANCELLED', 'Request cancelled', true));
        else signal.addEventListener('abort', () => reject(new AgentError('CANCELLED', 'Request cancelled', true)), { once: true, signal: cleanup.signal });
      })] : []),
    ]);
    if (!info.isDirectory()) throw new AgentError('ROOT_NOT_DIRECTORY', 'Provide a directory as root');
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(['ENOENT', 'ENOTDIR'].includes(error.code) ? 'ROOT_NOT_FOUND' : 'ROOT_INACCESSIBLE', 'Provide an accessible root directory', false, 'Check the root path spelling, availability, and permissions.');
  } finally { clearTimeout(timer); cleanup.abort(); }
}
