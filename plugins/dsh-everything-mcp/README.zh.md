# dsh-everything-mcp

[Everything Search MCP](https://github.com/EcRal5t/everything-search-mcp) 的 DeepSeek Harness 配置包：通过 DSH 内置的 MCP 客户端挂载服务器，模型侧得到 `mcp__everything__everything_search` 和 `mcp__everything__everything_status`。

纯配置，没有 Host 插件、没有 Web 界面、不需要构建、不落状态。

## 安装

```powershell
dsh plugin --profile <profile> add github:EcRal5t/everything-search-mcp#path:/plugins/dsh-everything-mcp
```

包发布到 npm 后也可以用短形式：

```powershell
dsh plugin --profile <profile> add dsh-everything-mcp
```

安装后重启该 profile。`pnpm` 需要在 `PATH` 上（DSH 插件管理器会转发给它）。

手工方式：在 profile 的 `cordis.patch.yml` 里加这一行：

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

## 前置条件

- **Windows**，Everything 1.4.1+ 或 1.5 正在运行（以它的索引为数据源）。
- **不需要单独装 ES 命令行**：服务器自带 x64/x86/ARM/ARM64 的 `es.exe`，并自动探测运行中的实例走 IPC，失败时回退 HTTP。

## 这个服务多出来的东西

- **批量查询。** 一次调用带 1–8 个请求，每个请求独立设置 `root`、`kind`、`regex`、`sort`、`count`、`offset`、`fields`——多步搜索只花一次工具往返，而不是八次。
- **紧凑输出，按 token 预算。** 返回行而非逐条对象，结果有上限，单个请求的错误就地返回。多数 `es.exe` 封装是每次查询起一个进程、回一段原始文本。
- **分页与总数。** `count: 0` 只取匹配数，`next_offset` 翻页，`fields: ["size"]` 附带文件大小合计。
- **契约上只读。** 两个工具都带 `readOnlyHint: true` / `destructiveHint: false`，可以放心保持自动批准。
- **一个服务，所有客户端。** Codex、OpenCode、Claude Desktop、Cursor 用的是同一个 stdio 服务；DSH 只是多一个宿主。

## 说明

- DSH 0.2.x 在启动时会先探测一次 stdio，所以服务进程会被 spawn 两次，无害。
- DSH 会清掉形似凭据的环境变量名（`/KEY|PASSWORD|SECRET|TOKEN/i`）和 `DSH_*`。需要 `EVERYTHING_PASSWORD` 时，写进这一行的 `env`，别指望父进程环境。
- 想要 DSH 里的 `@文件` 补全？那是原生插件的事。本包刻意只当 MCP 桥，好让同一个服务在所有客户端里通用。

## 许可

MIT，详见[主仓库](https://github.com/EcRal5t/everything-search-mcp)。
