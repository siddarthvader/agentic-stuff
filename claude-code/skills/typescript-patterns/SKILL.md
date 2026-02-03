---
name: typescript-patterns
description: Use when working with TypeScript, type definitions, or type errors
---

# TypeScript Patterns

Essential TypeScript patterns for robust, maintainable code.

## Core Principles

### 1. Strict Type Safety
Always use strict TypeScript configuration:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 2. Prefer Type over Interface for Unions
```typescript
// GOOD - Use type for unions and computed types
type Status = "pending" | "completed" | "failed";
type UserWithStatus = User & { status: Status };

// OK - Use interface for object shapes
interface User {
  id: string;
  name: string;
  email: string;
}
```

## Common Patterns

### Result Type Pattern
Always use Result types for operations that can fail:
```typescript
type Result<T, E = string> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

function parseUser(data: unknown): Result<User> {
  if (!isValidUser(data)) {
    return { ok: false, error: "Invalid user data" };
  }
  return { ok: true, data };
}

// Usage
const result = parseUser(input);
if (result.ok) {
  console.log(result.data.name); // Type-safe access
} else {
  console.error(result.error);
}
```

### Optional Chaining & Nullish Coalescing
```typescript
// GOOD - Safe property access
const userName = user?.profile?.name ?? "Unknown";
const config = settings?.theme ?? defaultTheme;

// BAD - Unsafe access
const userName = user.profile.name || "Unknown"; // Can throw
```

### Type Guards
```typescript
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value
  );
}

// Usage
if (isUser(data)) {
  // TypeScript knows data is User here
  console.log(data.name);
}
```

### Utility Types
```typescript
// Pick specific properties
type PublicUser = Pick<User, "id" | "name">;

// Make properties optional
type PartialUser = Partial<User>;

// Create from values
type UserRole = keyof typeof USER_ROLES;

// Exclude properties  
type CreateUser = Omit<User, "id" | "createdAt">;
```

## Anti-Patterns

### Don't Use Any
```typescript
// BAD
function process(data: any): any {
  return data.whatever;
}

// GOOD
function process<T>(data: T): T {
  return data;
}
```

### Don't Disable Strict Checks
```typescript
// BAD
// @ts-ignore
const result = riskyOperation();

// GOOD
const result = riskyOperation();
if (result) {
  // Handle the case properly
}
```

### Don't Use Function Overloads Unnecessarily
```typescript
// BAD - Complex overloads
function create(name: string): User;
function create(name: string, age: number): User;
function create(data: UserData): User;

// GOOD - Single function with union
function create(input: string | UserData): User {
  if (typeof input === "string") {
    return { id: generateId(), name: input };
  }
  return { id: generateId(), ...input };
}
```

## Error Handling Patterns

### Discriminated Unions
```typescript
type ApiResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code: number };

function handleResponse<T>(response: ApiResponse<T>): T {
  if (response.success) {
    return response.data; // TypeScript knows this is T
  }
  throw new Error(`API Error ${response.code}: ${response.error}`);
}
```

### Branded Types
```typescript
type UserId = string & { readonly brand: unique symbol };
type EmailAddress = string & { readonly brand: unique symbol };

function createUserId(id: string): UserId {
  return id as UserId;
}

function getUserById(id: UserId): User {
  // Can only be called with UserId, not raw string
  return findUser(id);
}
```

## Quick Reference

| Pattern | Use Case | Example |
|---------|----------|---------|
| `Result<T, E>` | Operations that can fail | `parseJson(text): Result<any>` |
| `Optional<T>` | Maybe values | `findUser(id): Optional<User>` |
| Type guards | Runtime type checking | `isString(x): x is string` |
| Utility types | Type transformations | `Pick<User, 'name'>` |
| Branded types | Prevent type confusion | `UserId` vs raw `string` |
| Union types | Multiple valid types | `'pending' \| 'done'` |
| `?.` and `??` | Safe access | `user?.name ?? 'Unknown'` |