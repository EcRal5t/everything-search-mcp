# Everything Search MCP

[简体中文](README.zh-CN.md)

Let your AI assistant find files on Windows using [Everything](https://www.voidtools.com/).

Search by name, path, extension, size, or date. Browse a folder, find the largest files, compare folder sizes, or count thousands of matches in one request. Results are paginated and include the metadata your assistant requests.

## Requirements

- Windows
- Node.js 22 or newer
- Everything 1.4.1 or newer, running with its index ready

The package includes the ES command-line helper and automatically finds your running Everything instance. The default connection uses local IPC.

## Connect your assistant

Add this to your MCP client's configuration:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "everything-agent"]
    }
  }
}
```

VS Code uses `servers` as the top-level key. Other clients may offer a form for the same command and arguments.

Try asking:

- “Find all PDF files under D:/Projects modified this week.”
- “Show the ten largest files in my Downloads folder.”
- “Compare the sizes of the folders directly inside D:/Projects.”
- “How many log files are in this project, and how large are they altogether?”

## What it does

The server provides two read-only tools:

| Tool | Purpose |
| --- | --- |
| `everything_search` | Search, browse folders, count matches, and retrieve file or folder sizes. Supports up to eight queries per call. |
| `everything_status` | Check the connection, selected instance, and Everything version. |

Search supports [Everything's query syntax](https://www.voidtools.com/support/everything/searching/), sorting, pagination, and PCRE patterns. Optional metadata includes sizes, timestamps, Windows attributes, and run counts. File and folder sizes are logical byte counts from Everything's index. Use a text-search tool such as `rg` to search inside files.

## Connection settings

Most installations work with the default settings. If you run several Everything instances, set `EVERYTHING_INSTANCE` to the one you want, such as `1.5a`. An empty string selects the default instance.

Setting `EVERYTHING_URL` selects an existing Everything HTTP service. Set `EVERYTHING_USERNAME` and `EVERYTHING_PASSWORD` if that service uses authentication. HTTP provides size and modified-time fields, with other metadata depending on the service; its supported sorts are name, path, size, and modified time.

Search returns 20 rows by default. Output is limited to 16 KiB per call, with pagination for further results. `EVERYTHING_MAX_RESULTS`, `EVERYTHING_OUTPUT_BYTES`, and `EVERYTHING_TIMEOUT_MS` adjust the row cap, output budget, and search timeout. `EVERYTHING_ES_PATH` selects a custom ES executable.

To check your connection:

```powershell
npx -y everything-agent doctor
```

## Run from source

```powershell
git clone https://github.com/EcRal5t/everything-search-mcp.git
cd everything-search-mcp
npm ci --ignore-scripts
node src/cli.js doctor
```

For a local checkout, configure your client to run `node` with the absolute path to `src/cli.js`. For example:

```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": ["D:/Projects/everything-search-mcp/src/cli.js"]
    }
  }
}
```

`npm run install:codex` registers the checkout with Codex and installs the optional search skill.

## Development

Run `npm test` for the regression tests and `npm run test:live` to check a real Everything connection. Set `EVERYTHING_TEST_HTTP_URL` to compare that IPC connection with an HTTP service on the same index during the live check.

See [PUBLISHING.md](https://github.com/EcRal5t/everything-search-mcp/blob/HEAD/PUBLISHING.md) for release instructions.

## License

MIT. The bundled ES helper is also MIT-licensed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for sources and licenses. Everything is developed and distributed by voidtools.
