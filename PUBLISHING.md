# Publishing

Source: https://github.com/EcRal5t/everything-search-mcp

npm package: `everything-mcp-server`

MCP Registry name: `io.github.EcRal5t/everything-search-mcp`

## Prepare a release

Set the release version in `package.json`, `server.json`, and `server.json`'s npm package entry. The MCP handshake reads the version from `package.json`.

```powershell
npm ci --ignore-scripts
npm test
npm run test:live
npm pack --dry-run
```

Check that the tarball contains the source, documentation, ES helpers, and licenses. Install it in a separate directory and verify the MCP connection. Commit the release metadata, push to GitHub, and create the matching version tag and GitHub release.

## Publish to npm

```powershell
npm login
npm publish
```

Verify in a clean terminal:

```powershell
npx -y everything-mcp-server doctor
```

## Publish to the MCP Registry

Download [mcp-publisher](https://github.com/modelcontextprotocol/registry/releases) for Windows and add it to PATH.

```powershell
mcp-publisher login github
mcp-publisher validate
mcp-publisher publish
```

GitHub authentication verifies the `io.github.EcRal5t/` namespace.

## References

- [MCP Registry Quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- [npm Publishing Guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
