---
name: example-skill
description: Example Claude Code skill template for creating new skills
---

# Example Skill Template

This is a template for creating new Claude Code skills that work with the claude-skills.ts pi extension.

## Skill Structure

Skills should be organized as:
```
.claude/skills/
└── skill-name/
    └── SKILL.md
```

## Frontmatter Format

Each skill should include YAML frontmatter:
```yaml
---
name: skill-name
description: Brief description of when to use this skill
---
```

**Fields:**
- `name` - Skill identifier (defaults to folder name if not provided)
- `description` - When to trigger this skill (shown to pi)

## Content Guidelines

### Be Specific
- Focus on concrete patterns, not generic advice
- Include code examples with context
- Explain WHY patterns should be used

### Use Action Triggers
Include clear triggers in the description:
```yaml
description: Use when user says "write tests", "add tests", "create test"
```

### Include Anti-Patterns
Show what NOT to do alongside correct patterns:
```typescript
// BAD - loses reactivity
let { theme } = editor;

// GOOD - keeps reactivity  
let { theme } = $derived(editor);
```

### Structure for Scanning
Use headers that pi can easily parse:
- `## Core Concepts` - Main principles
- `## Patterns` - Common code patterns
- `## Anti-Patterns` - What to avoid
- `## Examples` - Concrete use cases

## Skill Categories

### Framework-Specific
- `svelte-runes` - Svelte 5 reactivity patterns
- `react-hooks` - React hook patterns
- `vue-composition` - Vue 3 composition API

### Testing
- `testing` - Testing strategies and patterns
- `e2e-testing` - End-to-end testing approaches
- `unit-testing` - Unit test patterns

### Language-Specific  
- `typescript-patterns` - TypeScript best practices
- `python-patterns` - Python idioms
- `rust-patterns` - Rust ownership patterns

### Tool-Specific
- `git-workflow` - Git branching strategies
- `docker-patterns` - Containerization practices
- `api-design` - REST/GraphQL design

## Integration with Pi

When the claude-skills extension loads this skill:

1. **Parses frontmatter** for name and description
2. **Includes content in system prompt** under "Claude Code Skills"
3. **Makes available via `/skills`** command to refresh
4. **Shows in status** as skill count

Pi will automatically apply these patterns when working with your codebase.

## Example Skill

Here's a minimal working example:

```yaml
---
name: error-handling
description: Use when handling errors, exceptions, or failure cases
---

# Error Handling Patterns

## Core Principle
Always use Result types, never throw exceptions in business logic.

## Pattern: Result Type
\`\`\`typescript
type Result<T, E = string> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

function processUser(id: string): Result<User> {
  const user = findUser(id);
  if (!user) {
    return { ok: false, error: "User not found" };
  }
  return { ok: true, data: user };
}
\`\`\`

## Usage
\`\`\`typescript
const result = processUser("123");
if (result.ok) {
  console.log(result.data.name);
} else {
  console.error(result.error);
}
\`\`\`
```

This skill would trigger when pi encounters error handling scenarios and guide it to use Result types consistently.