# dsh-everything-mcp

DeepSeek Harness bundle for [Everything Search MCP](https://github.com/EcRal5t/everything-search-mcp). It mounts the server through DSH's in-box MCP client, so the model gets `mcp__everything__everything_search` and `mcp__everything__everything_status`.

Configuration only: no Host plugin, no web UI, no build step, no state.

## Install

```powershell
dsh plugin --profile <profile> add github:EcRal5t/everything-search-mcp#path:/plugins/dsh-everything-mcp
```

Once this package is on npm, the shorter form works too:

```powershell
dsh plugin --profile <profile> add dsh-everything-mcp
```

Restart the profile afterwards. `pnpm` must be on `PATH` — the DSH plugin manager forwards to it.

Manual alternative: add this row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-everything
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: everything
        transport: stdio
        command: npx
        args: ['-y', 'everything-mcp-server']
```

## Requirements

- **Windows**, with Everything 1.4.1+ or 1.5 running (its index is the search source).
- **No separate ES command-line client.** The server ships `es.exe` for x64/x86/ARM/ARM64 and auto-detects the running instance over IPC, falling back to HTTP.

## What this server gives you

- **Batch queries.** One call carries 1–8 requests — each with its own `root`, `kind`, `regex`, `sort`, `count`, `offset` and `fields` — so a multi-step search costs one tool round-trip instead of eight.
- **Compact, token-aware output.** Rows instead of per-hit objects, a bounded result budget, and per-query errors returned in place. Most `es.exe` wrappers spawn once per query and hand back a raw text dump.
- **Pagination and totals.** `count: 0` returns just the match count, `next_offset` continues, and `fields: ["size"]` adds file-size sums.
- **Read-only by contract.** Both tools carry `readOnlyHint: true` / `destructiveHint: false`, so they are safe to leave auto-approved.
- **One server, every client.** The same stdio server is what Codex, OpenCode, Claude Desktop and Cursor use; DSH is just another host.

## Notes

- On DSH 0.2.x the stdio transport is probed once at startup, so the server process is spawned twice. Harmless.
- DSH scrubs credential-shaped env names (`/KEY|PASSWORD|SECRET|TOKEN/i`) and `DSH_*`. If you need `EVERYTHING_PASSWORD`, put it in the row's `env` instead of the parent environment.
- Want `@file` completion in DSH? That is a native plugin's job. This bundle deliberately stays a plain MCP bridge, so the same server works in every client.

## License

MIT — see the [repository](https://github.com/EcRal5t/everything-search-mcp) for details.
