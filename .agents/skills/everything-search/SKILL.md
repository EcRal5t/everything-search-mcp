---
name: everything-search
description: Find Windows files, compare folder sizes, and summarize indexed logical storage with Everything.
---

Use the Everything MCP tools:

- `everything_search`: `requests:[{query,root,count,fields}]`, 1–8 requests. `count:0` counts, `recursive:false` lists children. Defaults: count=20, kind=any.
- `everything_storage`: root plus mode `largest_files` or `directories`. Directory sums complete the selected scope by default; `allow_partial:true` returns explicit path-prefix lower bounds.
- `everything_status`: connection, selected instance, version and repair hints; `verbose:true` includes limits.

Combine `base` with each relative row path. `columns` names each cell. Continue with `next_offset` and the same filters. File and folder sizes use indexed logical bytes; physical-space tools measure allocated/reclaimable storage.

Use `!path:node_modules` for directory exclusions, `regex:true` for a validated PCRE pattern, and `rg` for file content. Results cover the selected live index. Query help is available as `everything://syntax`.

CLI from the project root: `node src/cli.js doctor`, `node src/cli.js search --stdin`, `node src/cli.js storage --stdin`. IPC discovers a running Everything instance automatically; `EVERYTHING_INSTANCE` selects among multiple indexes. Explicit HTTP settings select that backend. Search uses the same requests array as the MCP tool.
