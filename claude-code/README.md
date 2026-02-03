# Claude Code Skills & Patterns

Skills and patterns for Claude Code (claude.ai/code) - Anthropic's official coding interface.

## 💡 What are Claude Code Skills?

Skills are project-specific coding patterns and practices that Claude Code automatically references when working on your codebase. They're stored in `.claude/skills/` folders and contain:

- **Framework patterns** (React hooks, Svelte runes, etc.)
- **Testing strategies** (E2E, unit testing approaches)
- **Code conventions** (naming, structure, error handling)
- **Architecture decisions** (state management, API design)

## 📁 Skill Structure

```
.claude/skills/
├── framework-patterns/
│   └── SKILL.md           # React/Svelte/Vue patterns
├── testing/
│   └── SKILL.md           # Testing strategies
├── api-design/
│   └── SKILL.md           # REST/GraphQL conventions
└── typescript-patterns/
    └── SKILL.md           # TypeScript best practices
```

Each `SKILL.md` file contains:
```markdown
---
name: skill-name
description: When to trigger this skill
---

# Skill Content
Your patterns, examples, and guidelines...
```

## 🎯 Skill Categories

### Framework-Specific
- **svelte-runes** - Svelte 5 reactive state management
- **react-patterns** - React hooks and component patterns  
- **vue-composition** - Vue 3 composition API patterns
- **nextjs-patterns** - Next.js routing and SSR patterns

### Language-Specific
- **typescript-patterns** - TypeScript best practices and types
- **python-patterns** - Python idioms and patterns
- **rust-patterns** - Rust ownership and error handling
- **go-patterns** - Go concurrency and interfaces

### Architecture
- **api-design** - REST/GraphQL design principles
- **database-patterns** - Schema design and query patterns
- **state-management** - Global state patterns
- **error-handling** - Error boundaries and recovery

### Testing
- **testing-strategies** - Unit, integration, E2E approaches
- **test-patterns** - Mocking, fixtures, test organization
- **performance-testing** - Load testing and optimization

### DevOps
- **deployment-patterns** - CI/CD and deployment strategies
- **monitoring** - Observability and alerting
- **security** - Security best practices and patterns

## 🚀 Using Skills

### With Claude Code
Skills are automatically loaded when you use Claude Code in a project with `.claude/skills/` folders. Just start coding and Claude will apply your patterns.

### With Pi + claude-skills Extension
Install the claude-skills extension to make pi aware of your skills:
```bash
cp ../pi/extensions/claude-skills.ts .pi/extensions/
```

## 📖 Skill Examples

### Framework Pattern Example
```markdown
---
name: react-hooks
description: Use when working with React components and state management
---

# React Hooks Patterns

## State Management
Use `useState` for local state, `useContext` for shared state:

\`\`\`tsx
// Local state
const [count, setCount] = useState(0);

// Shared state
const theme = useContext(ThemeContext);
\`\`\`

## Effect Patterns
Always include dependencies array:
\`\`\`tsx
// Good - with dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);

// Bad - missing dependencies
useEffect(() => {
  fetchData(userId);
}, []);
\`\`\`
```

### Testing Pattern Example
```markdown
---
name: testing
description: Use when writing tests, mentions "test", "spec", or testing frameworks
---

# Testing Patterns

## Test Structure
Use describe/it pattern with clear descriptions:

\`\`\`typescript
describe('UserService', () => {
  it('should create user when valid data provided', () => {
    // Arrange
    const userData = { name: 'John', email: 'john@example.com' };
    
    // Act
    const result = userService.create(userData);
    
    // Assert
    expect(result.success).toBe(true);
  });
});
\`\`\`

## Mocking Patterns
Mock external dependencies:
\`\`\`typescript
const mockDatabase = {
  save: jest.fn().mockResolvedValue({ id: 1 }),
  find: jest.fn().mockResolvedValue(null)
};
\`\`\`
```

## 🛠️ Creating Skills

### 1. Identify Patterns
Look for repetitive coding decisions in your projects:
- How do you handle errors?
- What's your preferred state management?
- How do you structure tests?
- What naming conventions do you use?

### 2. Create Skill File
```bash
mkdir -p .claude/skills/my-pattern
cp examples/skill-template/SKILL.md .claude/skills/my-pattern/
```

### 3. Write Clear Patterns
- Include code examples
- Show both good and bad patterns  
- Explain WHY patterns should be used
- Add clear trigger conditions

### 4. Test the Skill
Use Claude Code or pi with the skill loaded and verify it applies your patterns correctly.

## 📦 Reusable Skills

Skills in this repository can be copied to any project:

```bash
# Copy specific skill
cp skills/typescript-patterns .claude/skills/

# Copy multiple skills
cp -r skills/testing skills/api-design .claude/skills/
```

## 🤝 Contributing

### Adding New Skills
1. Create skill in `skills/` directory
2. Follow the skill template format
3. Include clear examples and anti-patterns
4. Test with Claude Code or pi
5. Update this README

### Skill Quality Guidelines
- **Specific over generic** - Focus on concrete patterns
- **Examples over explanations** - Show don't just tell
- **Anti-patterns included** - Show what NOT to do
- **Clear triggers** - Describe when to apply the skill
- **Project-agnostic** - Skills should work across projects

## 🔗 Integration

### With Pi Extensions
The claude-skills.ts extension automatically loads skills into pi's system prompt.

### With Development Tools
Skills can be referenced by:
- Linters and formatters
- Code generators  
- Documentation tools
- Team onboarding materials

---

*Skills make AI coding assistants much more effective by providing project-specific context and patterns. They're the key to consistent, high-quality code generation.*