---
name: everything-search
description: Find Windows files and compare indexed file and folder sizes with Everything.
---

Use the two read-only Everything MCP tools:

- everything_search: requests:[{query,root,count,fields}], 1–8 requests. count:0 counts; recursive:false lists direct children. Defaults: count=20, kind=any.
- everything_status: selected connection, instance, version and readiness; verbose:true includes index count and limits.

Combine base with each relative row path; columns label cells. Continue with next_offset and the same filters. fields:["size"] returns indexed logical bytes for files and folders. Compare child folders with recursive:false, kind:"folder". Find the largest files with kind:"file", sort:"size", ascending:false.

Use !path:node_modules for directory exclusions, regex:true for a validated PCRE pattern, and rg for file content. Query help is available as everything://syntax. Dedicated disk-space tools provide physical-space analysis.

CLI from the project root: node src/cli.js doctor or node src/cli.js search --stdin. IPC discovers a running Everything instance automatically; EVERYTHING_INSTANCE selects among indexes. An explicit EVERYTHING_URL selects HTTP. Search uses the same requests array as the MCP tool.
