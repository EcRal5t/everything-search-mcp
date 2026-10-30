import path from 'node:path';
import { AgentError } from './schema.js';

const integerEnv = (env, name, fallback, min, max) => {
  if (env[name] === undefined || env[name] === '') return fallback;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new AgentError('INVALID_CONFIG', `${name} must be an integer between ${min} and ${max}`);
  return n;
};
export function configFromEnv(env = process.env) {
  let url;
  try { url = new URL(env.EVERYTHING_URL || 'http://127.0.0.1/'); }
  catch { throw new AgentError('INVALID_CONFIG', 'EVERYTHING_URL must be an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new AgentError('INVALID_CONFIG', 'Use an HTTP(S) origin without credentials, path, query or fragment; use EVERYTHING_USERNAME/PASSWORD for authentication');
  }
  return {
    url: url.href,
    username: env.EVERYTHING_USERNAME || '', password: env.EVERYTHING_PASSWORD || '',
    maxResults: integerEnv(env, 'EVERYTHING_MAX_RESULTS', 1000, 1, 1000),
    outputBytes: integerEnv(env, 'EVERYTHING_OUTPUT_BYTES', 16384, 4096, 65536),
    responseBytes: integerEnv(env, 'EVERYTHING_RESPONSE_BYTES', 2097152, 4096, 16777216),
    timeoutMs: integerEnv(env, 'EVERYTHING_TIMEOUT_MS', 15000, 100, 120000),
    local: ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  };
}

export function normalizeRoot(root) {
  const value = root.replaceAll('/', '\\');
  // Reject search operators and relative/device paths before embedding in query syntax.
  if (!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+(?:\\|$))/i.test(value) || /["<>|*?\x00-\x1f]/.test(value) || value.startsWith('\\\\.\\') || value.startsWith('\\\\?\\') || /:(?!\\)/.test(value)) {
    throw new AgentError('INVALID_ARGUMENT', 'root must be an absolute Windows drive or UNC directory without wildcards or query operators');
  }
  const normalized = path.win32.normalize(value);
  return normalized.length > path.win32.parse(normalized).root.length ? normalized.replace(/\\+$/, '') : normalized;
}

export function composeQuery(input) {
  const filters = [];
  if (input.root) {
    const root = normalizeRoot(input.root);
    filters.push(input.recursive ? `path:"${root.endsWith('\\') ? root : root + '\\'}"` : `parent:"${root}"`);
  }
  if (input.kind !== 'any') filters.push(`${input.kind}:`);
  let query = input.query;
  // HTTP regex=1 disables all native filters. Use a scoped modifier instead.
  if (input.regex && query) query = `regex:"${query.replaceAll('"', '\\x22')}"`;
  if (query) filters.push(filters.length ? `<${query}>` : query);
  return filters.join(' ');
}

export function filetimeToISO(value) {
  if (value === undefined || value === null || value === '' || String(value) === '0') return null;
  try {
    // BigInt avoids rounding away 100-nanosecond Windows FILETIME ticks.
    const milliseconds = BigInt(value) / 10000n - 11644473600000n;
    if (milliseconds < -8640000000000000n || milliseconds > 8640000000000000n) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch { return null; }
}

export function resultPath(row) {
  // Everything represents indexed drive roots as name="C:", path="".
  if (row.path === '' && /^[a-z]:$/i.test(row.name)) return `${row.name}\\`;
  const fullPath = path.win32.join(row.path, row.name);
  if (!/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+)/i.test(fullPath)) throw new AgentError('INVALID_RESPONSE', 'Everything returned a non-absolute result path');
  return fullPath;
}

export const syntax = {
  query_language: 'Everything native syntax; regex:true treats query as a PCRE filename/path pattern',
  examples: [
    { query: 'ext:pdf;docx report', purpose: 'Documents with report in filename' },
    { query: 'size:>100mb dm:thismonth', purpose: 'Large recently modified files' },
    { query: '<ext:ts | ext:js> !path:node_modules !path:.git', root: 'D:\\Projects', purpose: 'Source files beneath a directory' },
    { query: '^IMG_\\d+\\.jpg$', regex: true, purpose: 'Filename regex' },
    { query: 'ext:log', kind: 'file', count: 0, fields: ['size'], purpose: 'Count matching files and sum their indexed logical bytes' },
  ],
  operators: { and: 'space', or: '|', not: '!', grouping: '<...>', literal: '"..."', wildcard: '* ?', extension: 'ext:ts;js', size: 'size:>10mb or size:1kb..1mb', modified: 'dm:today / dm:thisweek / dm:2026-01-01..2026-12-31', created: 'dc:thismonth', direct_children: 'parent:"D:\\Projects"' },
  notes: ['Empty query matches all; omitted root searches the selected index.', 'Use regex:true with a PCRE pattern; root/kind filters stay active.', 'Use this service for paths and metadata, and rg for file content. Directory exclusions use !path:node_modules.', 'Results and pagination use a live index. File and folder sizes use indexed logical bytes.'],
  docs: ['https://www.voidtools.com/support/everything/searching/', 'https://www.voidtools.com/support/everything/http/'],
};

export function logicalBytes(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const bytes = BigInt(value);
  return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : bytes.toString();
}
export function relativePath(root, full) {
  const relative = path.win32.relative(root, full);
  if (relative === '..' || relative.startsWith('..\\') || path.win32.isAbsolute(relative)) throw new AgentError('INVALID_RESPONSE', 'Expected a result within root');
  return relative || '.';
}

export class HttpTransport {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }
  async request(input, count, query, signal) {
    if (input.sort && !['name', 'path', 'size', 'date_modified'].includes(input.sort)) throw new AgentError('UNSUPPORTED_QUERY', `Use IPC for sort:${input.sort}; HTTP sorts by name, path, size or date_modified.`);
    const url = new URL(this.config.url);
    const params = {
      search: query, json: 1, count, offset: input.offset ?? 0,
      sort: input.sort ?? 'path', ascending: input.ascending === false ? 0 : 1,
      path_column: count > 0 ? 1 : 0, size_column: input.fields?.includes('size') ? 1 : 0,
      date_modified_column: input.fields?.includes('date_modified') ? 1 : 0,
      regex: 0, case: 0, wholeword: 0, path: 0, diacritics: 0, prefix: 0, suffix: 0,
      ignore_punctuation: 0, ignore_whitespace: 0,
    };
    for (const field of input.fields ?? []) params[`${field}_column`] = 1;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const deadline = AbortSignal.timeout(input.timeout_ms ?? this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const headers = { Accept: 'application/json' };
    if (this.config.username || this.config.password) headers.Authorization = 'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64');
    try {
      if (combined.aborted) throw combined.reason;
      const response = await this.fetch(url, { headers, signal: combined, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AgentError('AUTH_REQUIRED', 'Set EVERYTHING_USERNAME and EVERYTHING_PASSWORD for this HTTP service.');
        throw new AgentError('HTTP_ERROR', 'Everything returned HTTP ' + response.status, response.status >= 500);
      }
      if (!response.body) throw new AgentError('INVALID_RESPONSE', 'Expected a JSON response body');
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > this.config.responseBytes) throw new AgentError('RESPONSE_TOO_LARGE', 'Reduce count or fields to fit the backend response budget.');
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AgentError('INVALID_RESPONSE', 'Expected JSON from the configured Everything HTTP service'); }
      if (!Number.isSafeInteger(data?.totalResults) || data.totalResults < 0 || !Array.isArray(data.results) || data.results.length > count) throw new AgentError('INVALID_RESPONSE', 'Expected a valid search result envelope');
      for (const field of (input.fields ?? []).filter(field => !['size', 'date_modified'].includes(field))) {
        if (data.results.some(row => !(field in row))) throw new AgentError('UNSUPPORTED_METADATA', `Use IPC for ${field}; the selected HTTP service provides other metadata columns.`);
      }
      return data;
    } catch (error) {
      if (combined.aborted) throw new AgentError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', signal?.aborted ? 'Request cancelled' : 'HTTP request reached its time budget', true);
      if (error instanceof AgentError) throw error;
      throw new AgentError('CONNECTION_FAILED', 'Check the configured Everything HTTP URL and service availability.', true);
    }
  }
  async directorySize(root, input, signal) {
    // HTTP 1.4 may omit folder sizes; sum only the requested folder's indexed files.
    const scoped = { root, query: '', recursive: true, kind: 'file', fields: ['size'], timeout_ms: input.timeout_ms };
    return this.totalSize(scoped, composeQuery(scoped), signal);
  }
  async totalSize(input, query, signal) {
    let offset = 0, sum = 0n;
    for (;;) {
      const page = await this.request({ ...input, fields: ['size'], offset }, this.config.maxResults, query, signal);
      if (!page.results.length && offset < page.totalResults) throw new AgentError('INCOMPLETE_PAGE', 'Repeat the size query to obtain the remaining files.', true);
      for (const row of page.results) {
        if (row.type !== 'file' || typeof row.name !== 'string' || typeof row.path !== 'string') throw new AgentError('INVALID_RESPONSE', 'Expected indexed files for a size sum');
        if (input.root) relativePath(input.root, resultPath(row));
        if (logicalBytes(row.size) === null) throw new AgentError('METADATA_PENDING', 'Wait for indexed file sizes, then repeat the query.', true);
        sum += BigInt(row.size);
      }
      offset += page.results.length;
      if (offset >= page.totalResults) return sum.toString();
    }
  }
}
