import path from 'node:path';
import { validateQuery, validateRoot } from './validation.js';
import { AgentError, searchSchema, countSchema, storageSchema } from './schema.js';

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
    validateRoots: ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
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
  ],
  operators: { and: 'space', or: '|', not: '!', grouping: '<...>', literal: '"..."', wildcard: '* ?', extension: 'ext:ts;js', size: 'size:>10mb or size:1kb..1mb', modified: 'dm:today / dm:thisweek / dm:2026-01-01..2026-12-31', created: 'dc:thismonth', direct_children: 'parent:"D:\\Projects"' },
  notes: ['Empty query matches all; omitted root searches the selected index.', 'Use regex:true with a PCRE pattern; root/kind filters stay active.', 'Use this service for paths and metadata, and rg for file content. Directory exclusions use !path:node_modules.', 'Results and pagination use a live index. File and folder sizes use indexed logical bytes.'],
  docs: ['https://www.voidtools.com/support/everything/searching/', 'https://www.voidtools.com/support/everything/http/'],
};

export class EverythingClient {
  constructor(config = configFromEnv(), fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async prepare(input, signal) {
    if (signal?.aborted) throw new AgentError('CANCELLED', 'Request cancelled', true);
    await validateQuery(input);
    if (input.root) {
      input.root = normalizeRoot(input.root);
      if (this.config.validateRoots !== false) await validateRoot(input.root, Math.min(input.timeout_ms ?? this.config.timeoutMs, 3000), signal);
    }
  }

  async request(input, count, signal) {
    if (signal?.aborted) throw new AgentError('CANCELLED', 'Request cancelled', true);
    const url = new URL(this.config.url);
    const query = composeQuery(input);
    const params = {
      search: query, json: 1, count, offset: input.offset ?? 0,
      sort: input.sort ?? 'path', ascending: input.ascending === false ? 0 : 1,
      path_column: count > 0 ? 1 : 0,
      size_column: input.fields?.includes('size') ? 1 : 0,
      date_modified_column: input.fields?.includes('date_modified') ? 1 : 0,
      // Use explicit options for consistent query behavior.
      regex: 0, case: +input.case_sensitive, wholeword: +input.whole_word,
      path: +input.match_path, diacritics: +input.diacritics,
      prefix: +input.prefix, suffix: +input.suffix,
      ignore_punctuation: +input.ignore_punctuation, ignore_whitespace: +input.ignore_whitespace,
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const timeout = AbortSignal.timeout(input.timeout_ms ?? this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const headers = { Accept: 'application/json' };
    if (this.config.username || this.config.password) headers.Authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    try {
      const response = await this.fetch(url, { headers, signal: combined, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AgentError('AUTH_REQUIRED', 'Everything rejected authentication. Set EVERYTHING_USERNAME and EVERYTHING_PASSWORD.', false);
        throw new AgentError('HTTP_ERROR', `Everything returned HTTP ${response.status}`, response.status >= 500);
      }
      const chunks = [];
      let bytes = 0;
      if (!response.body) throw new AgentError('INVALID_RESPONSE', 'Everything returned an empty response body');
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > this.config.responseBytes) throw new AgentError('RESPONSE_TOO_LARGE', 'Everything response exceeded the byte limit. Reduce count or requested fields.');
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AgentError('INVALID_RESPONSE', 'Expected JSON from Everything; check HTTP server configuration.'); }
      if (!Number.isSafeInteger(data?.totalResults) || data.totalResults < 0 || !Array.isArray(data.results) || data.results.length > count) throw new AgentError('INVALID_RESPONSE', 'Everything returned an invalid search result envelope');
      return { data, query };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if (combined.aborted) throw new AgentError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', signal?.aborted ? 'Request cancelled' : 'Everything request timed out; narrow the query or increase timeout_ms.', true);
      throw new AgentError('CONNECTION_FAILED', 'Start the Everything HTTP service and verify its URL and port.', true);
    }
  }

  async search(arguments_, signal, outputBytes = this.config.outputBytes) {
    const input = searchSchema.parse(arguments_);
    await this.prepare(input, signal);
    if (input.count === 0) return this.count(argumentsForCount(input), signal);
    const limit = Math.min(input.count, this.config.maxResults);
    const { data, query } = await this.request(input, limit, signal);
    const results = data.results.map(row => {
      if (!['file', 'folder'].includes(row?.type) || typeof row.name !== 'string' || typeof row.path !== 'string') throw new AgentError('INVALID_RESPONSE', 'Everything returned a result without a name, path or supported type');
      const result = { path: resultPath(row), type: row.type };
      if (input.fields.includes('size')) {
        const size = row.size === undefined || row.size === null || row.size === '' ? null : Number(row.size);
        result.size = Number.isSafeInteger(size) && size >= 0 ? size : null;
        if (size !== null && result.size === null) result.size_exact = String(row.size);
      }
      if (input.fields.includes('date_modified')) result.date_modified = filetimeToISO(row.date_modified);
      return result;
    });
    if (results.length === 0 && data.totalResults > input.offset) throw new AgentError('INCOMPLETE_PAGE', 'Everything reported more results but returned an empty page; retry or narrow the query.', true);
    const envelope = {
      ok: true, query, total: data.totalResults, offset: input.offset, returned: results.length,
      has_more: input.offset + results.length < data.totalResults,
      next_offset: input.offset + results.length < data.totalResults ? input.offset + results.length : null,
      limited_by: [], results,
    };
    if (input.fields.includes('size')) {
      envelope.size_basis = 'indexed_logical';
    }
    if (limit < input.count) envelope.limited_by.push('result_cap');
    if (Buffer.byteLength(JSON.stringify(envelope)) > outputBytes) {
      envelope.limited_by.push('output_bytes');
      while (results.length && Buffer.byteLength(JSON.stringify(envelope)) > outputBytes) {
        results.pop();
        envelope.returned = results.length;
        envelope.has_more = input.offset + results.length < data.totalResults;
        envelope.next_offset = envelope.has_more ? input.offset + results.length : null;
      }
      if (!results.length) throw new AgentError('OUTPUT_TOO_LARGE', 'A result or query exceeds the output budget. Reduce requested fields or query length, or increase EVERYTHING_OUTPUT_BYTES.');
    }
    return envelope;
  }

  async count(arguments_, signal) {
    const input = countSchema.parse(arguments_);
    await this.prepare(input, signal);
    const { data, query } = await this.request(input, 0, signal);
    return { ok: true, query, total: data.totalResults };
  }

  async status(signal, verbose = false) {
    const result = await this.count({},signal);
    return {ready:true,transport:'http',version:null,instance:null,capabilities:['paths','count','file_size','modified_time','logical_storage'],problems:[],
      ...(verbose ? {details:{total_indexed:result.total,backend:this.config.url}} : {})};
  }

  async storage(arguments_, signal) {
    const input = storageSchema.parse(arguments_);
    await this.prepare(input, signal);
    const root = normalizeRoot(input.root);
    if (input.mode === 'largest_files') {
      const page = await this.search({ root, query: input.query, kind: 'file', sort: 'size', ascending: false,
        count: input.top, fields: ['size'], timeout_ms: input.timeout_ms }, signal);
      if (page.returned < Math.min(input.top, page.total)) throw new AgentError('OUTPUT_TOO_LARGE', 'Choose a smaller top value within the configured result and byte limits.');
      return { ok: true, complete: true, status: 'complete', mode: input.mode, root, size_basis: 'indexed_logical',
        total_matching_files: page.total, scanned_files: page.returned, size_complete: !page.results.some(r => r.size === null),
        unknown_sizes: page.results.filter(r => r.size === null).length, ranking_scope: 'all_matches',
        largest_files: page.results.map(r => ({ path: r.path, indexed_logical_bytes: r.size_exact ?? r.size })) };
    }
    const deadline = AbortSignal.timeout(input.timeout_ms);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    const groups = new Map();
    const largest = [];
    let scanned = 0, total = null, knownBytes = 0n, unknown = 0, stopReason = null;
    const preflight = await this.count({ root, query: input.query, kind: 'file', timeout_ms: input.timeout_ms }, combined);
    total = preflight.total;
    if (total > input.max_entries && !input.allow_partial) throw new AgentError('SCAN_LIMIT', `${total} files exceed max_entries=${input.max_entries}; no directory ranking was computed.`, false, 'Narrow root/query, increase max_entries, or explicitly set allow_partial:true for path-prefix lower bounds.');
    while (scanned < input.max_entries) {
      let page;
      try {
        page = await this.request(searchSchema.parse({ query: input.query, root, kind: 'file', count: 1, offset: scanned, fields: ['size'], timeout_ms: input.timeout_ms }), Math.min(this.config.maxResults, input.max_entries - scanned), combined);
      } catch (error) {
        if (signal?.aborted) throw new AgentError('CANCELLED', 'Request cancelled', true);
        if (deadline.aborted) { stopReason = 'timeout'; break; }
        throw error;
      }
      total = page.data.totalResults;
      if (!page.data.results.length) {
        if (scanned < total) throw new AgentError('INCOMPLETE_PAGE', 'Everything returned an empty storage scan page before the reported total', true);
        break;
      }
      for (const row of page.data.results) {
        if (row.type !== 'file' || typeof row.name !== 'string' || typeof row.path !== 'string') throw new AgentError('INVALID_RESPONSE', 'Invalid file row in storage scan');
        const fullPath = resultPath(row);
        const relative = path.win32.relative(root, row.path);
        // Group rows within the selected root.
        if (relative.startsWith('..\\') || relative === '..' || path.win32.isAbsolute(relative)) throw new AgentError('INVALID_RESPONSE', 'Storage scan received a path outside its root');
        const directory = path.win32.join(root, ...relative.split('\\').filter(Boolean).slice(0, input.depth));
        const group = groups.get(directory) ?? { path: directory, files: 0, bytes: 0n, unknown: 0 };
        group.files++;
        let bytes = null;
        if (/^\d+$/.test(String(row.size))) bytes = BigInt(row.size);
        if (bytes === null) { unknown++; group.unknown++; }
        else {
          knownBytes += bytes; group.bytes += bytes;
          largest.push({ path: fullPath, bytes });
          largest.sort((a, b) => a.bytes > b.bytes ? -1 : a.bytes < b.bytes ? 1 : a.path.localeCompare(b.path));
          if (largest.length > input.top) largest.pop();
        }
        groups.set(directory, group);
        scanned++;
      }
      if (scanned >= total) break;
    }
    const complete = total !== null && scanned >= total;
    if (!complete && !stopReason) stopReason = 'max_entries';
    if (!complete && !input.allow_partial) throw new AgentError('INCOMPLETE_SCAN', `Directory scan stopped after ${scanned} of ${total ?? 'unknown'} files.`, true, 'Narrow the scope or explicitly request allow_partial:true.');
    const encodeSize = bytes => bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : bytes.toString();
    const directories = [...groups.values()].sort((a, b) => a.bytes > b.bytes ? -1 : a.bytes < b.bytes ? 1 : a.path.localeCompare(b.path)).slice(0, input.top).map(g => ({ path: g.path, files: g.files, indexed_logical_bytes: encodeSize(g.bytes), unknown_sizes: g.unknown }));
    const result = {
      ok: true, root, status: complete ? 'complete' : 'partial', mode: input.mode, size_basis: 'indexed_logical',
      size_complete: complete && unknown === 0, ranking_scope: complete ? 'all_matches' : 'scanned_files',
      complete, stop_reason: stopReason, total_matching_files: total, scanned_files: scanned,
      indexed_logical_bytes: encodeSize(knownBytes), unknown_sizes: unknown,
      ...(complete ? { directories } : { directory_lower_bounds: directories }), largest_files: largest.map(f => ({ path: f.path, indexed_logical_bytes: encodeSize(f.bytes) })),
      caveats: ['Indexed logical bytes for directory comparison.', 'Partial sums cover the scanned path prefix of the live index.'],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > this.config.outputBytes) throw new AgentError('OUTPUT_TOO_LARGE', 'Storage summary exceeds output budget; reduce top or root/query length.');
    return result;
  }
}

function argumentsForCount(input) {
  const { count, offset, sort, ascending, fields, ...filters } = input;
  return filters;
}
