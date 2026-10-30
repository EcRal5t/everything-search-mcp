import { z } from 'zod';

export const requestSchema = z.object({
  query: z.string().max(8192).default('').describe('Everything path/metadata query; use rg for content.'),
  root: z.string().max(1024).optional().describe('Absolute Windows directory/drive; omitted = global.'),
  recursive: z.boolean().default(true).describe('With root: descendants vs direct children.'),
  kind: z.enum(['any', 'file', 'folder']).default('any'),
  regex: z.boolean().default(false).describe('Query as PCRE; root/kind still apply.'),
  count: z.number().int().min(0).max(1000).default(20).describe('Maximum rows; 0 counts. With kind:file and fields:[size], also sums all matched file bytes.'),
  offset: z.number().int().min(0).max(4294967295).default(0),
  sort: z.enum(['name', 'path', 'size', 'extension', 'date_modified', 'date_created', 'date_accessed', 'attributes', 'run_count']).default('path').describe('HTTP supports name/path/size/date_modified; IPC supports all listed sorts.'),
  ascending: z.boolean().default(true),
  fields: z.array(z.enum(['size', 'date_modified', 'date_created', 'date_accessed', 'attributes', 'run_count'])).max(6).default([]).describe('Optional columns. IPC supports all; HTTP metadata depends on the server.'),
}).strict();
export const searchSchema = requestSchema.extend({ timeout_ms: z.number().int().min(100).max(120000).optional() });
export const requestsSchema = z.object({ requests: z.array(requestSchema).min(1).max(8) }).strict();
export const diagnosticSchema = z.object({ verbose: z.boolean().default(false) }).strict();
const uint = z.number().int().nonnegative();
export const errorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), hint: z.string().optional() });
export const searchOutputSchema = z.object({ results: z.array(z.union([
  z.object({
    total: uint, next_offset: uint.nullable(), base: z.string().optional(),
    columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    limited_by: z.array(z.string()).optional(), size_basis: z.literal('indexed_logical').optional(),
  }).strict(),
  z.object({ total: uint, total_size_bytes: z.union([uint, z.string()]).optional(), size_basis: z.literal('indexed_logical').optional() }).strict(), z.object({ error: errorSchema }).strict(),
])) }).strict();
export const statusOutputSchema = z.object({
  ready: z.boolean(), transport: z.string().nullable(), version: z.string().nullable(), instance: z.string().nullable(),
  capabilities: z.array(z.string()), problems: z.array(errorSchema), details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export class AgentError extends Error {
  constructor(code, message, retryable = false, hint) {
    super(message);
    Object.assign(this, { code, retryable, hint });
  }
}
export function errorResult(error) {
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: error.issues.map(issue => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; '), retryable: false } };
  return { ok: false, error: { code: error instanceof AgentError ? error.code : 'INTERNAL_ERROR', message: error instanceof AgentError ? error.message : 'Unexpected internal error', retryable: error.retryable ?? false, ...(error.hint ? { hint: error.hint } : {}) } };
}
