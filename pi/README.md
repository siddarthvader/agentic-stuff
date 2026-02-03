# Pi Coding Agent Extensions

Extensions and tools for the pi terminal-based AI coding assistant.

## 🔌 Extensions

### claude-skills.ts
Automatically loads Claude Code skills from `.claude/skills/` folders into pi's system prompt.

**Features:**
- ✅ Auto-discovers skill files on session start
- ✅ Injects content into system prompt  
- ✅ `/skills` command to refresh
- ✅ Status display showing skill count

**Installation:**
```bash
cp extensions/claude-skills.ts .pi/extensions/
```

### todo-manager.ts
Persistent todo list that integrates with pi's AI context.

**Features:**
- ✅ Add/complete/remove todos via AI tools
- ✅ Persistent storage in `.pi/todos.json`
- ✅ Priority levels and tags
- ✅ Automatic injection into system prompt
- ✅ `/todo` and `/todos-clear` commands
- ✅ Status bar showing todo count

**Installation:**
```bash
cp extensions/todo-manager.ts .pi/extensions/
```

**Usage:**
```bash
# In pi session
/todo "Fix the login bug"           # Add todo
/todo                               # List todos  
/todos-clear                        # Clear completed

# AI can also manage todos
"Add a todo to refactor the auth module"
"Mark the login bug todo as complete"
"What are my current high priority todos?"
```

## 📚 Documentation

- **[Extension Development Guide](docs/extension-development.md)** - Complete guide to creating pi extensions
- **[Skill Template](examples/skill-template/)** - Template for Claude Code skills

## 🚀 Quick Start

### Install Extensions
```bash
# Project-local (recommended)
mkdir -p .pi/extensions
cp extensions/*.ts .pi/extensions/

# Global (all projects)  
mkdir -p ~/.pi/agent/extensions
cp extensions/*.ts ~/.pi/agent/extensions/
```

### Test Extensions
```bash
# Check syntax
pi -e ./extensions/claude-skills.ts --version

# Test functionality
pi -e ./extensions/claude-skills.ts -p "What skills do you have?"
```

### Create Skills (for claude-skills.ts)
```bash
mkdir -p .claude/skills/my-pattern
cp examples/skill-template/SKILL.md .claude/skills/my-pattern/
# Edit the skill content
```

## 🎯 Extension Ideas

### Development Workflow
- **git-workflow.ts** - Auto-commit, branching, release management
- **test-runner.ts** - Run tests on file changes, show results in status
- **deploy-manager.ts** - Deployment pipelines and environment management

### Code Quality
- **linter-integration.ts** - Real-time linting feedback
- **code-review.ts** - Automated code review patterns
- **docs-generator.ts** - Auto-generate documentation from code

### Team Collaboration  
- **jira-integration.ts** - Issue tracking and project management
- **slack-notifications.ts** - Team alerts and updates
- **knowledge-base.ts** - Team knowledge and patterns

### Database & APIs
- **db-tools.ts** - Database query and schema tools
- **api-tester.ts** - REST/GraphQL testing and documentation
- **monitoring.ts** - System health and performance monitoring

### UI & Visualization
- **progress-tracker.ts** - Visual progress bars for long tasks
- **dashboard.ts** - Project metrics and status dashboard
- **file-explorer.ts** - Interactive file navigation

## 📖 Resources

- [Pi Official Documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- [Extension Examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [TUI Components](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)

## 🤝 Contributing

1. Create extension in `extensions/` directory
2. Add documentation with usage examples  
3. Test with `pi -e ./extension.ts --version`
4. Update README with feature description

Extensions should follow pi's patterns:
- Handle errors gracefully
- Check `ctx.hasUI` before UI operations
- Clean up resources on `session_shutdown`
- Use proper TypeScript types