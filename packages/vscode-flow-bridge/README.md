# asuka.pi Flow Bridge

This VS Code companion exposes workspace symbol search and exact source navigation to the native `asuka.pi` `/flow` command. It only listens on a local named pipe or Unix domain socket and accepts clients that match its per-process token and canonical workspace root.

Phase 1 supports:

- `vscode.executeWorkspaceSymbolProvider`;
- exact source opening through `window.showTextDocument`;
- one bridge endpoint per local workspace folder.

## Install

Released `asuka.pi` npm packages and standalone binaries include the companion VSIX. Install it without a marketplace lookup, reload the VS Code window that contains the workspace, and verify the local pipe:

```bash
pi flow install
pi flow doctor
```

Use `pi flow install --code code-insiders` when the preferred VS Code launcher is not `code`.

## Development

Build the coding-agent package first so the shared protocol declarations exist, then open this directory as the VS Code workspace and press F5. The included launch configuration builds the bridge and starts an Extension Development Host on the monorepo root. Run `asuka.pi` from that same root in the development host terminal.

```bash
npm run build --workspace=asuka.pi
code packages/vscode-flow-bridge
```

```text
/flow createAgentSession
```

Use `asuka.pi: Show Flow Bridge Status` from the VS Code Command Palette to inspect the active workspace endpoints.
