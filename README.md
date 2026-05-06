# Agentic Stuff - Comprehensive AI Agent Tools

A curated collection of tools, extensions, and patterns for AI coding agents and agentic workflows.

## 🗂️ Repository Structure

```
agentic-stuff/
├── pi/                    # Pi coding agent stuff
│   ├── extensions/        # Pi extensions (.ts files)
│   ├── docs/             # Pi extension development guides
│   └── examples/         # Pi extension templates
├── claude-code/          # Claude Code specific stuff  
│   ├── skills/           # Reusable Claude Code skills
│   └── examples/         # Skill templates and patterns
├── tools/               # Standalone agentic tools
├── tmux/                # tmux helpers (session manager, shortcuts)
├── other/               # Other AI agent integrations
└── README.md
```

## 🤖 Pi Coding Agent

Pi is a terminal-based AI coding assistant with read/write/bash tools and extensible architecture.

### Extensions
Extensions live in **[pi/extensions/](pi/extensions/)** and are loaded through this repo's pi package manifest.

Current extensions include:
- **[ask-user-ui.ts](pi/extensions/ask-user-ui.ts)** - Interactive user prompt tool via pi UI
- **[audio-transcribe.ts](pi/extensions/audio-transcribe.ts)** - Audio transcription support
- **[claude-skills.ts](pi/extensions/claude-skills.ts)** - Auto-load Claude Code skills into pi
- **[git-worktree.ts](pi/extensions/git-worktree.ts)** - Git worktree workflow helpers
- **[history-context-finder.ts](pi/extensions/history-context-finder.ts)** - Search/summarize prior pi chat history
- **[smart-commit.ts](pi/extensions/smart-commit.ts)** - Assisted git commit workflow
- **[smart-tmux.ts](pi/extensions/smart-tmux.ts)** - Smart tmux pane reader
- **[thinking-trace](pi/extensions/thinking-trace/)** - Read assistant thinking/reasoning trace blocks; `/thinking-trace` opens a persistent HTMX/SSE browser viewer
- **[todo-manager.ts](pi/extensions/todo-manager.ts)** - Persistent todo list with AI integration
- **[web-text.ts](pi/extensions/web-text.ts)** - Fetch URLs and perform text web search

### Quick Start
```bash
# One-time install as a pi package
pi install /home/d2du/code/ug/agentic-stuff

# Add new extensions under pi/extensions/, then reload pi
/reload

# Test one extension directly
pi -e ./pi/extensions/claude-skills.ts --version
```

### Resources
- **[Extension Development Guide](pi/docs/extension-dev.md)**
- **[Extension Examples](pi/examples/)**
- [Pi Official Docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)

## 💭 Claude Code

Claude Code is the official coding interface from Anthropic with skills system for project-specific patterns.

### Skills System
- **Skills** are project-specific coding patterns stored in `.claude/skills/`
- **Automatically referenced** when using Claude Code or pi with claude-skills extension
- **Reusable across projects** by copying skill folders

### Available Skills
- **[Skill Templates](claude-code/examples/)** - Templates for creating new skills
- **Project-specific skills** - Check individual project `.claude/skills/` folders

### Quick Start
```bash
# Create new skill
mkdir -p .claude/skills/my-pattern
cp claude-code/examples/skill-template/SKILL.md .claude/skills/my-pattern/
# Edit the skill content

# Use with Claude Code - automatically loaded
# Use with pi - install claude-skills.ts extension
```

## 🛠️ Standalone Tools

Collection of agentic tools that work independently:

```
tools/
├── git-agents/           # Git workflow automation  
├── testing-agents/       # Automated testing tools
├── deploy-agents/        # Deployment automation
└── monitoring-agents/    # System monitoring
```

## 🖥️ tmux Helpers

- **[open-session-manager](tmux/open-session-manager/README.md)** - Popup picker for running agent sessions (switch fast with `Prefix + A`)

## 🔧 Other AI Agents

Integration patterns for other AI coding tools:

```
other/
├── cursor/              # Cursor IDE integrations
├── github-copilot/      # Copilot patterns
├── cody/                # Sourcegraph Cody tools
└── aider/               # Aider integrations
```

## 🎯 Common Use Cases

### Project Setup
1. **Install this repo as a pi package** with `pi install /path/to/agentic-stuff`
2. **Copy Claude skills** to `.claude/skills/` if needed
3. **Configure tools** for your tech stack
4. **Set up workflows** for your team

### Development Workflow
1. **Pi for implementation** - File editing, bash commands, code generation
2. **Claude Code for planning** - Architecture decisions, code review
3. **Skills for consistency** - Project-specific patterns and standards
4. **Tools for automation** - Testing, deployment, monitoring

### Team Collaboration
1. **Share skills** across team projects
2. **Standardize extensions** for consistent workflows
3. **Document patterns** in skills for knowledge sharing
4. **Automate workflows** with tools

## 📖 Getting Started

### For Pi Users
```bash
git clone https://github.com/siddarthvader/agentic-stuff
cd agentic-stuff

# Install this repo as a pi package
pi install "$PWD"

# Create first skill
mkdir -p .claude/skills/project-patterns
cp pi/examples/skill-template/SKILL.md .claude/skills/project-patterns/
```

### For Claude Code Users  
```bash
# Copy skills to your project
cp -r claude-code/skills/useful-pattern .claude/skills/

# Or create new skills using templates
cp claude-code/examples/skill-template .claude/skills/my-pattern
```

### For Tool Developers
```bash
# Create new tool
mkdir tools/my-agent
cd tools/my-agent
# Implement your agentic tool
```

## 🤝 Contributing

### Adding Pi Extensions
1. Create extension in `pi/extensions/`
2. Add development notes to `pi/docs/extension-dev.md` if needed
3. Test with `pi -e ./pi/extensions/my-extension.ts --version`
4. Run `/reload` in pi
5. Update this README if it should be advertised

### Adding Claude Skills
1. Create skill in `claude-code/skills/`
2. Follow skill template format
3. Test with Claude Code or pi + claude-skills extension
4. Document usage patterns

### Adding Tools
1. Create tool in `tools/category/`
2. Include README with setup/usage
3. Add to main README use cases
4. Test across different environments

## 📄 License

MIT License - Use, modify, and distribute freely.

---

*This repository serves as a central hub for all agentic development tools and patterns. Whether you're using pi, Claude Code, or other AI agents, you'll find useful extensions, skills, and workflows here.*