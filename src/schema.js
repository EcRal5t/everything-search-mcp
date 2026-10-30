import { z } from 'zod';

export const filterShape = {
  query: z.string().max(8192).default('').describe('Everything path/metadata query; empty matches all. Use rg for content.'),
  root: z.string().max(1024).optional().describe('Absolute Windows directory/drive; omitted = global.'),
  recursive: z.boolean().default(true).describe('With root: descendants vs direct children.'),
  kind: z.enum(['any', 'file', 'folder']).default('any'),
  regex: z.boolean().default(false).describe('Query as PCRE; root/kind still apply.'),
  case_sensitive: z.boolean().default(false),
  whole_word: z.boolean().default(false),
  match_path: z.boolean().default(false),
  diacritics: z.boolean().default(false),
  prefix: z.boolean().default(false),
  suffix: z.boolean().default(false),
  ignore_punctuation: z.boolean().default(false),
  ignore_whitespace: z.boolean().default(false),
  timeout_ms: z.number().int().min(100).max(120000).optional().describe('Request deadline; default 15000.'),
};
export const pageShape = {
  count: z.number().int().min(0).max(1000).default(20).describe('Maximum rows; 0 returns only the count.'),
  offset: z.number().int().min(0).max(4294967295).default(0),
  sort: z.enum(['name', 'path', 'size', 'date_modified']).default('path'),
  ascending: z.boolean().default(true),
  fields: z.array(z.enum(['size', 'date_modified'])).max(2).default([]).describe('Extras beyond path/type; size=bytes, date_modified=UTC ISO.'),
};
export const searchSchema = z.object({ ...filterShape, ...pageShape }).strict();
export const countSchema = z.object(filterShape).strict();
export const emptySchema = z.object({}).strict();
export const storageSchema = z.object({
  root: filterShape.root.unwrap(),
  query: filterShape.query.describe('File filter, e.g. size:>100mb.'),
  depth: z.number().int().min(1).max(6).default(2).describe('Directory grouping depth below root.'),
  top: z.number().int().min(1).max(50).default(20).describe('Top directory groups and files.'),
  max_entries: z.number().int().min(1).max(100000).default(20000).describe('Scan cap; exceeding it yields complete=false.'),
  timeout_ms: z.number().int().min(100).max(120000).default(30000).describe('Total scan deadline; partial on timeout.'),
  mode: z.enum(['directories', 'largest_files']).default('directories'),
  allow_partial: z.boolean().default(false).describe('Allow path-prefix sums; rankings then cover scanned files only.'),
}).strict();

// The compact MCP toolset exposes the common options once, inside a batch.
export const requestSchema = searchSchema.omit({ case_sensitive: true, whole_word: true, match_path: true,
  diacritics: true, prefix: true, suffix: true, ignore_punctuation: true, ignore_whitespace: true, timeout_ms: true })
  .extend({ fields: z.array(z.enum(['size','date_modified'])).max(2).default([]) });
export const requestsSchema = z.object({ requests: z.array(requestSchema).min(1).max(8) }).strict();
export const mcpStorageSchema = storageSchema.extend({ mode: z.enum(['directories', 'largest_files']).default('largest_files') });
export const diagnosticSchema = z.object({ verbose: z.boolean().default(false) }).strict();
const uint = z.number().int().nonnegative();
const bytes = z.union([uint, z.string().regex(/^\d+$/)]);
export const errorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), hint: z.string().optional() });
const tableSchema = z.object({
  total: uint, next_offset: uint.nullable(), base: z.string().optional(),
  columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  limited_by: z.array(z.string()).optional(), warnings: z.array(z.string()).optional(),
  size_basis: z.literal('indexed_logical').optional(),
}).strict();
export const searchOutputSchema = z.object({ results: z.array(z.union([
  tableSchema, z.object({ total: uint }).strict(), z.object({ error: errorSchema }).strict(),
])) }).strict();
export const storageOutputSchema = z.object({
  status: z.enum(['complete', 'partial']), mode: z.enum(['directories', 'largest_files']), root: z.string(),
  size_basis: z.literal('indexed_logical'), total_matching_files: uint.nullable(), scanned_files: uint,
  size_complete: z.boolean(), indexed_logical_bytes: bytes.optional(), unknown_sizes: uint,
  stop_reason: z.string().optional(), ranking_scope: z.enum(['all_matches', 'scanned_files']),
  directories: z.array(z.object({ path: z.string(), files: uint, indexed_logical_bytes: bytes, unknown_sizes: uint })).optional(),
  directory_lower_bounds: z.array(z.object({ path: z.string(), files: uint, indexed_logical_bytes: bytes, unknown_sizes: uint })).optional(),
  largest_files: z.array(z.object({ path: z.string(), indexed_logical_bytes: bytes.nullable() })),
}).strict();
export const statusOutputSchema = z.object({
  ready: z.boolean(), transport: z.string().nullable(), version: z.string().nullable(), instance: z.string().nullable(),
  capabilities: z.array(z.string()), problems: z.array(errorSchema),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export class AgentError extends Error {
  constructor(code, message, retryable = false, hint) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.hint = hint;
  }
}
export function errorResult(error) {
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: error.issues.map(i => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; '), retryable: false } };
  return { ok: false, error: { code: error instanceof AgentError ? error.code : 'INTERNAL_ERROR', message: error instanceof AgentError ? error.message : 'Unexpected internal error', retryable: error.retryable ?? false, ...(error.hint ? { hint: error.hint } : {}) } };
}
