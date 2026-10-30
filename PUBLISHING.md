# 发布

本项目使用 GitHub 托管源码、npm 分发可执行包、MCP Registry 提供官方目录发现。用户的 MCP 客户端通过 npx 在本机启动服务，连接本机 Everything。

## 首次发布准备

1. 创建公开 GitHub 仓库，配置本地 Git remote 并推送源码。
2. 确定 npm 包名、GitHub 所有者和首次发布版本。在 package.json 中填写 version、repository、keywords 和 mcpName，将 private 字段清除。MCP 握手采用相同的发布版本。
3. 使用 GitHub 身份发布 Registry 时，mcpName 采用 `io.github.<GitHub所有者>/everything-agent`。npm 包名独立选择，可以采用账号作用域。
4. README 加入已确定的 npx 启动命令和通用客户端配置，注明 Windows、Node.js 22+、Everything 1.4.1+ 的本机要求。
5. 运行 npm test、npm run test:live；使用 npm pack --dry-run 检查包内源码、ES 二进制和许可证。

## 发布 npm 包

```powershell
npm login
npm publish --access public
```

发布后，用实际包名在独立目录验证 `npx -y <包名> doctor` 和 MCP stdio 启动。用户需要在运行 MCP 的电脑上安装并启动 Everything。

## 登记 MCP Registry

从官方 Registry Releases 下载 Windows 版 mcp-publisher 并加入 PATH。在工程根目录运行：

```powershell
mcp-publisher init
```

生成的 server.json 填写 name、description、repository、version 和 packages。name 与 package.json 的 mcpName 一致；packages 使用 npm、实际包名、已发布版本以及 stdio transport。

```powershell
mcp-publisher login github
mcp-publisher validate
mcp-publisher publish
```

npm 保存运行包，MCP Registry 保存指向该包的元数据。客户端依据自身目录接入与配置方式发现和启动服务。

后续自动发布可使用 GitHub Actions 与 npm Trusted Publishing（OIDC）。

## 官方资料

- [MCP Registry 发布指南](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [MCP Registry Publisher 下载](https://github.com/modelcontextprotocol/registry/releases)
- [npm 发布指南](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
