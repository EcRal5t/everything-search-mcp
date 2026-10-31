# Everything Search MCP

[English](README.md)

让 AI 助手通过 [Everything](https://www.voidtools.com/) 查找 Windows 上的文件。

按名称、路径、扩展名、大小或日期搜索，也能浏览目录、找出最大的文件、比较文件夹大小，或一次统计数千个匹配项。搜索结果支持分页，并按助手的需要附带文件信息。

## 使用条件

- Windows
- Node.js 22 或更新版本
- Everything 1.4.1 或更新版本，已启动并完成索引

包内附带 ES 命令行工具，会自动查找正在运行的 Everything 实例，默认通过本机 IPC 连接。

## 连接 AI 助手

在 MCP 客户端配置中加入：

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

VS Code 的顶层字段使用 `servers`。其他客户端也可能提供填写命令和参数的设置界面。

可以试着问：

- “找出 D:/Projects 下本周修改过的 PDF。”
- “列出下载文件夹中最大的十个文件。”
- “比较 D:/Projects 直接子文件夹的大小。”
- “这个项目有多少个日志文件，总共多大？”

## 功能

提供两个只读工具：

| 工具 | 用途 |
| --- | --- |
| `everything_search` | 搜索、浏览目录、统计数量，以及取得文件或文件夹大小。每次调用最多提交八项查询。 |
| `everything_status` | 查看连接状态、所选实例和 Everything 版本。 |

搜索支持 [Everything 查询语法](https://www.voidtools.com/support/everything/searching/)、排序、分页和 PCRE 正则表达式。可按需取得大小、时间戳、Windows 属性和运行次数。文件与文件夹大小采用 Everything 索引中的逻辑字节数。搜索文件内容时可以使用 `rg` 等文本搜索工具。

## 连接设置

通常使用默认设置即可。如果同时运行多个 Everything 实例，可以用 `EVERYTHING_INSTANCE` 指定实例，例如 `1.5a`；空字符串选择默认实例。

设置 `EVERYTHING_URL` 后，会连接指定的 Everything HTTP 服务。服务启用认证时，用 `EVERYTHING_USERNAME` 和 `EVERYTHING_PASSWORD` 提供账号密码。HTTP 提供大小和修改时间字段，其他元数据取决于所选服务；支持按名称、路径、大小和修改时间排序。

搜索默认返回 20 行，每次调用的输出上限为 16 KiB，更多结果可通过分页取得。`EVERYTHING_MAX_RESULTS`、`EVERYTHING_OUTPUT_BYTES` 和 `EVERYTHING_TIMEOUT_MS` 分别调整行数上限、输出预算和搜索超时。`EVERYTHING_ES_PATH` 可指定自定义 ES 可执行文件。

检查连接：

```powershell
npx -y everything-agent doctor
```

## 从源码运行

```powershell
git clone https://github.com/EcRal5t/everything-search-mcp.git
cd everything-search-mcp
npm ci --ignore-scripts
node src/cli.js doctor
```

使用本地源码时，在客户端中配置 `node` 和 `src/cli.js` 的实际绝对路径，例如：

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

`npm run install:codex` 可将本地源码注册到 Codex，并安装配套的搜索技能。

## 开发

运行 `npm test` 执行回归测试，运行 `npm run test:live` 检查真实的 Everything 连接。将 `EVERYTHING_TEST_HTTP_URL` 设置为同一索引的 HTTP 服务地址，即可在真实连接检查中同时比较 IPC 与 HTTP 结果。

发布步骤见 [PUBLISHING.md](https://github.com/EcRal5t/everything-search-mcp/blob/HEAD/PUBLISHING.md)。

## 许可证

MIT。包内 ES 工具同样采用 MIT 许可证，来源与授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Everything 由 voidtools 开发和分发。
