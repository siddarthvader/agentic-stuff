---
name: example-skill
description: Example Claude Code skill template for creating new skills
---

# Example Skill Template

This is a template for creating new Claude Code skills that work with AI coding assistants.

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
- `description` - When to trigger this skill (shown to AI)

## Content Guidelines

### Be Specific
Focus on concrete patterns, not generic advice:
```typescript
// GOOD - Specific pattern
function handleApiError(error: ApiError): Result<void, string> {
  return { ok: false, error: error.message };
}

// BAD - Generic advice
// "Always handle errors properly"
```

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

### Structure for AI Scanning
Use headers that AI can easily parse:
- `## Core Concepts` - Main principles
- `## Patterns` - Common code patterns
- `## Anti-Patterns` - What to avoid
- `## Examples` - Concrete use cases
- `## Quick Reference` - Cheat sheet format

## Example Skill Categories

### Framework-Specific
- `svelte-runes` - Svelte 5 reactivity patterns
- `react-hooks` - React hook patterns
- `vue-composition` - Vue 3 composition API
- `angular-signals` - Angular signals patterns

### Testing
- `testing` - Testing strategies and patterns
- `e2e-testing` - End-to-end testing approaches
- `unit-testing` - Unit test patterns
- `mocking-patterns` - Mock strategies

### Language-Specific  
- `typescript-patterns` - TypeScript best practices
- `python-patterns` - Python idioms
- `rust-patterns` - Rust ownership patterns
- `go-patterns` - Go concurrency patterns

### Architecture
- `api-design` - REST/GraphQL design
- `database-patterns` - Schema and query design
- `state-management` - Global state patterns
- `error-handling` - Error boundaries and recovery

### Tools & Workflow
- `git-workflow` - Branching strategies
- `docker-patterns` - Containerization practices
- `ci-cd-patterns` - Pipeline best practices
- `deployment-strategies` - Release patterns

## Integration with AI

When AI assistants load this skill:

1. **Parses frontmatter** for name and description
2. **Includes content in context** for code generation
3. **Applies patterns automatically** when working on related code
4. **References during code review** and suggestions

## Example Skill

Here's a minimal working example:

```markdown
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

## Usage Pattern
\`\`\`typescript
const result = processUser("123");
if (result.ok) {
  console.log(result.data.name);
} else {
  console.error(result.error);
}
\`\`\`

## Anti-Pattern
\`\`\`typescript
// DON'T throw in business logic
function processUser(id: string): User {
  const user = findUser(id);
  if (!user) {
    throw new Error("User not found"); // BAD
  }
  return user;
}
\`\`\`

## Quick Reference
- Use Result<T, E> for operations that can fail
- Return errors as data, don't throw
- Handle Results with if (result.ok) pattern
- Keep error messages user-friendly
```

This skill would trigger when AI encounters error handling scenarios and guide it to use Result types consistently.

## Tips for Writing Skills

### 1. Start Small
Begin with one specific pattern you use repeatedly.

### 2. Include Context
Explain WHY the pattern is better, not just HOW to use it.

### 3. Use Real Examples
Pull actual code from your projects (anonymized).

### 4. Test with AI
Use the skill with Claude Code or pi to verify it works as expected.

### 5. Iterate
Refine based on how well the AI applies the patterns.

### 6. Share Patterns
Skills work best when shared across team projects for consistency.