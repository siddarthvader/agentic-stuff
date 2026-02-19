# open-session-manager

High-performance tmux popup session switcher for active **pi / claude / codex** panes.
B gguilt with **TypeScript + Bun + OpenTUI + SolidJS**.

## Project isolation

This folder is a standalone package with its own:
- `package.json`
- `bunfig.toml`
- dependencies (`node_modules` local to this folder)

It does not rely on parent repo package setup.

## Structure

- `open-session-manager.tmux` — tmux keybinding entrypoint
- `src/main.tsx` — OpenTUI app

## Install deps (inside this folder)

```bash
cd /home/d2du/code/ug/agentic-stuff/tmux/open-session-manager
bun install
```

## Run (dev)

```bash
bun run start
```

## List detected sessions

```bash
bun run list
```

## tmux integration

In `~/.tmux.conf`:

```tmux
run-shell /home/d2du/code/ug/agentic-stuff/tmux/open-session-manager/open-session-manager.tmux
```

Reload:

```bash
tmux source-file ~/.tmux.conf
```

## Config

```tmux
set -g @agent_sessions_key 'a'
set -g @agent_session_commands 'pi claude codex'
set -g @agent_sessions_popup_width '70%'
set -g @agent_sessions_popup_height '70%'
# optional: debug action dispatch (writes logs from run.sh)
# set -g @agent_sessions_debug_log '/tmp/open-session-manager.log'
```
