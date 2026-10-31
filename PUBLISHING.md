# Publishing

Source: https://github.com/EcRal5t/everything-search-mcp

npm package: `everything-agent`

MCP Registry name: `io.github.EcRal5t/everything-search-mcp`

## Prepare the first release

Choose the first release version when you are ready to publish. Set it in `package.json`, `server.json`, and `server.json`'s npm package entry. The MCP handshake uses the version from `package.json`.

Remove `private` from `package.json` to enable npm publishing. `publishConfig` selects the public npm registry and public access.

```powershell
npm ci --ignore-scripts
npm test
npm run test:live
npm pack --dry-run
```

Check that the package contains the source, both READMEs, ES helpers, and licenses. Commit the release metadata and push the source to GitHub.

## Publish to npm

```powershell
npm login
npm publish
```

In a separate directory, run `npx -y everything-agent doctor` and connect an MCP client using the README configuration.

## Publish to the MCP Registry

Download [mcp-publisher](https://github.com/modelcontextprotocol/registry/releases) for Windows and add it to PATH. The repository includes `server.json`; its npm package version should match the version just published.

```powershell
mcp-publisher login github
mcp-publisher validate
mcp-publisher publish
```

GitHub authentication verifies the `io.github.EcRal5t/` namespace. The npm package's `mcpName` matches `server.json`'s name.

## Automation

The first release can use the commands above. Once that process is established, GitHub Actions can run the same steps with npm Trusted Publishing and GitHub OIDC for the MCP Registry.

- [Official MCP Registry guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [npm publishing](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
