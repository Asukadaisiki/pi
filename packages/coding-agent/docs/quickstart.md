# Quickstart

This page gets you from install to a useful first pi session.

## Install

Pi is distributed as an npm package:

```bash
npm install -g --ignore-scripts asuka.pi
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Pi does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed pi. The curl installer uses npm globally, so curl and npm installs are removed with npm:

```bash
# curl installer or npm install -g
npm uninstall -g asuka.pi

# pnpm
pnpm remove -g asuka.pi

# Yarn
yarn global remove asuka.pi

# Bun
bun uninstall -g asuka.pi
```

Uninstalling pi leaves settings, credentials, sessions, and installed pi packages in `~/.pi/agent/`.

Then start pi in the project directory you want it to work on:

```bash
cd /path/to/project
pi
```

## Configure a provider

Pi loads providers from `~/.pi/agent/config.json`. Each entry declares its vendor, protocol, complete request endpoint, authentication sources, and bundled model catalog.

Create a minimal OpenAI configuration:

```json
{
  "default": { "provider": "openai", "model": "gpt-5.5", "thinking": "high" },
  "providers": {
    "openai": {
      "name": "OpenAI",
      "vendor": "openai",
      "protocol": "openai-responses",
      "url": "https://api.openai.com/v1/responses",
      "auth": { "type": "api-key", "env": ["OPENAI_API_KEY"] },
      "modelCatalog": "openai"
    }
  }
}
```

Set the declared API key before launching pi:

```bash
export OPENAI_API_KEY=sk-...
pi
```

You can also run `/login` to store an API key for a configured provider in `~/.pi/agent/auth.json`. A configured Claude provider additionally offers Claude Pro/Max OAuth.

See [Providers](providers.md) for the supported vendors and protocols, exact-endpoint semantics, and authentication precedence.

## First session

Once pi starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, pi gives the model four tools:

- `read` - read files
- `write` - create or overwrite files
- `edit` - patch files
- `bash` - run shell commands

Additional built-in read-only tools (`grep`, `find`, `ls`) are available through tool options. Pi runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Give pi project instructions

Pi loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Pi loads:

- `~/.pi/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart pi, or run `/reload`, after changing context files.

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
pi @README.md "Summarize this"
pi @src/app.ts @src/app.test.ts "Review these together"
```

Images or text can be pasted with Ctrl+V (Alt+V on Windows); images can also be dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to choose a model. Use Shift+Tab to cycle thinking level. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue later

Sessions are saved automatically:

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse previous sessions
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Open a specific session
```

Inside pi, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
pi -p "Summarize this codebase"
cat README.md | pi -p "Summarize this text"
pi -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Using Pi](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Pi Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
