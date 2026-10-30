# Everything Agent

Windows 上的 Everything 文件搜索 MCP，支持 Everything 1.4.1+ 与 1.5。
提供路径检索、计数、目录浏览和文件/文件夹逻辑大小。文件内容检索可使用 rg，磁盘容量分析可使用专门的空间工具。

## 本地使用

需要 Node.js 22+ 和已安装、正在运行且完成首次索引的 Everything。

```powershell
npm ci --ignore-scripts
node src/cli.js doctor
npm run install:codex
```

安装器将本项目注册到 Codex，并安装搜索技能；配置使用当前 Node.js 和仓库入口的绝对路径，已有条目保持原值。重新加载 MCP 连接即可发现工具。其他客户端使用实际绝对路径：

```json
{"mcpServers":{"everything":{"command":"D:/path/to/node.exe","args":["D:/path/to/everything-agent/src/cli.js"]}}}
```

项目内 .mcp.json 适用于以项目根目录为工作目录的开发客户端。项目处于首次发布前，MCP 握手版本保持 unreleased。

## 两个 MCP 工具

| 工具 | 用途 |
|---|---|
| everything_search | requests 中提交 1–8 项查询；默认每项 20 行；count:0 计数；recursive:false 浏览直接子项 |
| everything_status | 读取选中的连接、实例、版本和索引可用状态；verbose:true 提供索引数量与限制 |

查找最大的文件：

```json
{"requests":[{"root":"D:/Projects","kind":"file","fields":["size"],"sort":"size","ascending":false,"count":20}]}
```

比较直接子文件夹的大小，也可以在同次调用中提交多个 root：

```json
{"requests":[{"root":"D:/Projects","recursive":false,"kind":"folder","fields":["size"],"count":20}]}
```

取得所有匹配文件的总字节数：

```json
{"requests":[{"root":"D:/Projects","query":"ext:log","kind":"file","count":0,"fields":["size"]}]}
```

返回 `{"results":[{"total":4689,"total_size_bytes":9751226,"size_basis":"indexed_logical"}]}`。纯计数使用 count:0 和默认 fields。IPC 通过 ES 直接求和；HTTP 分页读取匹配文件的索引大小，沿用搜索请求的时间预算。

返回表格格式：

```json
{"results":[{"base":"D:/Projects","total":2,"next_offset":null,"columns":["path","type","size_bytes"],"rows":[["app","folder",1048576],["notes.txt","file",256]],"size_basis":"indexed_logical"}]}
```

base 与行路径组合为绝对路径；全局搜索直接返回绝对路径。columns 对应行单元格，next_offset 用于继续翻页。索引实时更新，分页以当时的索引状态为准。输出裁剪也会同步推进分页位置。

fields 按需选择 size、date_modified、date_created、date_accessed、attributes 和 run_count，结果列分别为 size_bytes、modified_utc、created_utc、accessed_utc、attributes 和 run_count。时间使用 UTC ISO 格式，attributes 为 Windows 文件属性位掩码。sort 支持 name、path、size、extension、date_modified、date_created、date_accessed、attributes 和 run_count；ascending 控制升降序。

IPC 提供上述全部字段和排序。HTTP 提供 size、date_modified 字段及 name、path、size、date_modified 排序，额外元数据字段由所选 HTTP 服务提供；服务支持范围以明确错误返回。

大小使用 indexed_logical 字节，超大整数以十进制字符串表示，待取得的文件元数据为 null。Everything 1.4 IPC 通过 ES 对文件大小求和获得目录大小，1.5 IPC 使用索引值。HTTP 在缺少目录大小时仅扫描所请求文件夹内的索引文件；求和遵循整个搜索请求的时间预算，待取得的求和元数据返回 METADATA_PENDING。

搜索支持 Everything 名称、路径、扩展名、大小和日期语法。例如：<ext:ts | ext:js> !path:node_modules !path:.git。regex:true 将 query 作为 PCRE 表达式并预校验；后端按其 Everything 版本解释查询。查询语法资源为 everything://syntax。

## 连接与边界

默认通过包内 ES 1.1.0.38 和本机 IPC 自动发现实例。多个实例通过 EVERYTHING_INSTANCE 选择，空字符串选择默认实例；成功连接持续使用同一索引。Windows 实例枚举只读取运行中的实例标识。

显式设置 EVERYTHING_URL 时使用指定 HTTP 服务。1.4 的内置 HTTP 服务和 1.5 的 HTTP 插件均由用户在 Everything 中配置并启动。

| 环境变量 | 用途 / 默认 |
|---|---|
| EVERYTHING_INSTANCE | 选择实例，例如 1.5a；空字符串为默认实例 |
| EVERYTHING_ES_PATH | 自定义 ES 1.1.0.38+ 可执行文件 |
| EVERYTHING_URL | 显式 HTTP(S) 服务地址 |
| EVERYTHING_USERNAME / EVERYTHING_PASSWORD | HTTP 认证 |
| EVERYTHING_MAX_RESULTS | 单页及批量总行数上限，默认 1000 |
| EVERYTHING_OUTPUT_BYTES | 最终 JSON 输出预算，默认 16384，范围 4096–65536 |
| EVERYTHING_RESPONSE_BYTES | 后端单次响应预算，默认 2097152 |
| EVERYTHING_TIMEOUT_MS | 搜索请求时间预算，默认 15000 |

本机连接会检查 root 目录；远程 HTTP 的范围由远程索引确定。状态诊断在后端启动期间也可调用。搜索与诊断只读，安装操作由独立的 install:codex 脚本执行。

最大文件和文件夹比较通过 everything_search 完成。输出同时提供结构化数据和 JSON 文本。

## CLI、验证与迁移

CLI 提供 mcp、doctor、search、help。search 使用与 MCP 相同的 requests 格式，支持 JSON、--input file.json 和 --stdin；doctor 输出只读诊断。stdout 输出一个 JSON 对象，错误退出码为 1。

```powershell
npm test
npm run test:live
npm run test:parity
npm run check:transfer
npm run pack:transfer
```

test:live 通过真实 MCP stdio 验证中文、空格、多层目录、分页和逻辑大小，4 个样本文件合计 142 字节，完成后自动清理样本。IPC 显式使用 UTF-8 代码页，适配 Windows 区域设置。test:parity 需要将 EVERYTHING_TEST_HTTP_URL 设置为同一索引的已运行 HTTP 服务，比较 IPC 与 HTTP 查询结果。

pack:transfer 从已提交内容生成 artifacts/everything-agent-transfer.zip，包含源码、Git 仓库、锁文件和四种架构的固定版本 ES。迁移步骤见 [MIGRATION.md](MIGRATION.md)；第三方来源和哈希见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 vendor/es/manifest.json。
