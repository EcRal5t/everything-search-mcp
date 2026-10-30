# 迁移与 Everything 验证

发送 artifacts/everything-agent-transfer.zip，在目标电脑解压得到 everything-agent 目录。迁移包包含 Git 仓库、源码、测试、依赖锁文件和 x64/x86/ARM64/ARM 的 ES 工具。

目标环境使用 Windows、Node.js 22+、npm 和 Everything 1.4.1+ 或 1.5。运行 npm ci --ignore-scripts 安装依赖，node src/cli.js doctor 检查本机 IPC。安装器记录所选 Node.js 和仓库入口的实际绝对路径。

## 可交给目标电脑会话的提示词

```text
当前目录是 Everything MCP 的开发仓库。请阅读 README.md、MIGRATION.md 和 package.json，检查 Node.js 22+、npm、Git、Everything 实际版本和运行状态，保持本机已有的 Everything 版本。

本 MCP 聚焦查找文件：两个工具为 everything_search 和 everything_status，支持计数、目录浏览、分页、文件和文件夹逻辑大小。最大文件通过搜索的大小排序取得。默认使用包内 ES 的 IPC 自动发现；显式 EVERYTHING_URL 连接指定 HTTP 服务。

使用 npm ci --ignore-scripts 安装依赖，运行 doctor，完成当前对话工具的 MCP 绝对路径配置，通过 stdio 确认两个工具及 unreleased 握手。运行 scripts/verify-live.js，以中文、空格、多层目录的 4 个样本文件验证搜索、计数、分页、文件和多个文件夹大小；目录总量须与文件长度之和 142 字节一致。检查无效 PCRE 和缺失目录的明确错误。

本机已配置同一索引的 HTTP 服务时，显式设置 EVERYTHING_TEST_HTTP_URL 并运行 test:parity，核对 IPC 与 HTTP。需要重载连接时，先完成真实 stdio 验证再给出重载步骤。

发现兼容性问题可直接在仓库内修复、验证并提交。实现保持简洁，新增复杂度应直接服务于文件查找。最后报告选中实例、通道、配置位置、验证结果、修复和直接使用方法。
```

## 开发命令

```powershell
npm ci --ignore-scripts
node src/cli.js doctor
npm run test:live
npm run check:transfer
```

npm run pack:transfer 从已提交的 Git 内容生成迁移 ZIP，包含该提交对应的完整 Git 仓库。目标电脑可以继续提交后续修改。
