/**
 * Todo Manager Extension
 * 
 * Manages a persistent todo list for your coding projects.
 * Todos persist across pi sessions and can be referenced by the AI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  created: number;
  completed_at?: number;
  tags: string[];
}

interface TodoState {
  todos: Todo[];
  nextId: number;
}

export default function todoManagerExtension(pi: ExtensionAPI) {
  let state: TodoState = { todos: [], nextId: 1 };
  let todoFile = "";

  function loadTodos(): void {
    if (fs.existsSync(todoFile)) {
      try {
        const data = fs.readFileSync(todoFile, "utf-8");
        state = JSON.parse(data);
      } catch (error) {
        console.warn("Failed to load todos:", error);
      }
    }
  }

  function saveTodos(): void {
    try {
      fs.writeFileSync(todoFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn("Failed to save todos:", error);
    }
  }

  function generateId(): string {
    return `todo-${state.nextId++}`;
  }

  function updateStatus(ctx: any): void {
    if (!ctx.hasUI) return;
    
    const pending = state.todos.filter(t => !t.completed).length;
    const high = state.todos.filter(t => !t.completed && t.priority === "high").length;
    
    if (pending === 0) {
      ctx.ui.setStatus("todos", "✅ All done!");
    } else if (high > 0) {
      ctx.ui.setStatus("todos", `📋 ${pending} todos (${high} high priority)`);
    } else {
      ctx.ui.setStatus("todos", `📋 ${pending} todos`);
    }
  }

  // Load todos on session start
  pi.on("session_start", async (_event, ctx) => {
    todoFile = path.join(ctx.cwd, ".pi", "todos.json");
    
    // Ensure .pi directory exists
    const piDir = path.dirname(todoFile);
    if (!fs.existsSync(piDir)) {
      fs.mkdirSync(piDir, { recursive: true });
    }
    
    loadTodos();
    updateStatus(ctx);
    
    if (ctx.hasUI && state.todos.length > 0) {
      const pending = state.todos.filter(t => !t.completed).length;
      ctx.ui.notify(`${pending} todos loaded`, "info");
    }
  });

  // Inject current todos into system prompt
  pi.on("before_agent_start", async (event) => {
    const activeTodos = state.todos.filter(t => !t.completed);
    if (activeTodos.length === 0) return;

    const todoList = activeTodos
      .sort((a, b) => {
        // Sort by priority then by creation time
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority];
        const bPriority = priorityOrder[b.priority];
        if (aPriority !== bPriority) return bPriority - aPriority;
        return a.created - b.created;
      })
      .map(todo => {
        const priority = todo.priority === "high" ? "🔴" : 
                        todo.priority === "medium" ? "🟡" : "🟢";
        const tags = todo.tags.length > 0 ? ` [${todo.tags.join(", ")}]` : "";
        return `  ${priority} ${todo.text}${tags}`;
      })
      .join("\n");

    return {
      systemPrompt: event.systemPrompt + `

## Current Todos

You have ${activeTodos.length} pending todo(s):

${todoList}

When working on code, consider these todos and suggest completing relevant ones. Use the todo_manage tool to mark items as complete when you finish them.
`
    };
  });

  // Todo management tool
  pi.registerTool({
    name: "todo_manage",
    label: "Todo Management",
    description: "Add, list, complete, or remove todos for the project",
    parameters: Type.Object({
      action: StringEnum(["add", "list", "complete", "remove", "clear_completed"] as const),
      text: Type.Optional(Type.String({ description: "Todo text (for add action)" })),
      id: Type.Optional(Type.String({ description: "Todo ID (for complete/remove actions)" })),
      priority: Type.Optional(StringEnum(["low", "medium", "high"] as const)),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for categorization" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      switch (params.action) {
        case "add":
          if (!params.text) {
            return {
              content: [{ type: "text", text: "Error: Text is required for adding todos" }],
              details: { error: "Missing text parameter" }
            };
          }

          const newTodo: Todo = {
            id: generateId(),
            text: params.text,
            completed: false,
            priority: params.priority || "medium",
            created: Date.now(),
            tags: params.tags || []
          };

          state.todos.push(newTodo);
          saveTodos();
          updateStatus(ctx);

          return {
            content: [{ type: "text", text: `Added todo: "${params.text}" (${newTodo.priority} priority)` }],
            details: { todo: newTodo, action: "added" }
          };

        case "list":
          const activeTodos = state.todos.filter(t => !t.completed);
          if (activeTodos.length === 0) {
            return {
              content: [{ type: "text", text: "No active todos! 🎉" }],
              details: { todos: [], count: 0 }
            };
          }

          const todoText = activeTodos
            .sort((a, b) => {
              const priorityOrder = { high: 3, medium: 2, low: 1 };
              return priorityOrder[b.priority] - priorityOrder[a.priority];
            })
            .map(todo => {
              const priority = todo.priority === "high" ? "🔴" : 
                             todo.priority === "medium" ? "🟡" : "🟢";
              const tags = todo.tags.length > 0 ? ` [${todo.tags.join(", ")}]` : "";
              const age = Math.floor((Date.now() - todo.created) / (1000 * 60 * 60 * 24));
              const ageStr = age > 0 ? ` (${age}d old)` : "";
              return `${priority} ${todo.id}: ${todo.text}${tags}${ageStr}`;
            })
            .join("\n");

          return {
            content: [{ type: "text", text: `Active Todos (${activeTodos.length}):\n\n${todoText}` }],
            details: { todos: activeTodos, count: activeTodos.length }
          };

        case "complete":
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: ID is required for completing todos" }],
              details: { error: "Missing id parameter" }
            };
          }

          const todoToComplete = state.todos.find(t => t.id === params.id);
          if (!todoToComplete) {
            return {
              content: [{ type: "text", text: `Todo with ID "${params.id}" not found` }],
              details: { error: "Todo not found" }
            };
          }

          if (todoToComplete.completed) {
            return {
              content: [{ type: "text", text: `Todo "${todoToComplete.text}" is already completed` }],
              details: { todo: todoToComplete, action: "already_completed" }
            };
          }

          todoToComplete.completed = true;
          todoToComplete.completed_at = Date.now();
          saveTodos();
          updateStatus(ctx);

          return {
            content: [{ type: "text", text: `✅ Completed: "${todoToComplete.text}"` }],
            details: { todo: todoToComplete, action: "completed" }
          };

        case "remove":
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: ID is required for removing todos" }],
              details: { error: "Missing id parameter" }
            };
          }

          const todoIndex = state.todos.findIndex(t => t.id === params.id);
          if (todoIndex === -1) {
            return {
              content: [{ type: "text", text: `Todo with ID "${params.id}" not found` }],
              details: { error: "Todo not found" }
            };
          }

          const removedTodo = state.todos.splice(todoIndex, 1)[0];
          saveTodos();
          updateStatus(ctx);

          return {
            content: [{ type: "text", text: `Removed todo: "${removedTodo.text}"` }],
            details: { todo: removedTodo, action: "removed" }
          };

        case "clear_completed":
          const completedCount = state.todos.filter(t => t.completed).length;
          state.todos = state.todos.filter(t => !t.completed);
          saveTodos();
          updateStatus(ctx);

          return {
            content: [{ type: "text", text: `Cleared ${completedCount} completed todos` }],
            details: { count: completedCount, action: "cleared_completed" }
          };

        default:
          return {
            content: [{ type: "text", text: `Unknown action: ${params.action}` }],
            details: { error: "Unknown action" }
          };
      }
    },

    renderResult(result, { expanded }, theme) {
      if (result.details?.error) {
        return `${theme.fg("error", "❌")} ${result.details.error}`;
      }

      const action = result.details?.action;
      switch (action) {
        case "added":
          const todo = result.details?.todo;
          const priority = todo?.priority === "high" ? "🔴" : 
                         todo?.priority === "medium" ? "🟡" : "🟢";
          return `${theme.fg("success", "✅")} ${priority} Added: ${theme.fg("dim", todo?.text)}`;
        
        case "completed":
          return `${theme.fg("success", "✅")} Completed: ${theme.fg("strikethrough", result.details?.todo?.text)}`;
        
        case "removed":
          return `${theme.fg("warning", "🗑️")} Removed: ${theme.fg("dim", result.details?.todo?.text)}`;
        
        case "cleared_completed":
          return `${theme.fg("success", "🧹")} Cleared ${result.details?.count} completed todos`;
        
        default:
          return result.content?.[0]?.text || "Todo operation completed";
      }
    }
  });

  // Todo commands
  pi.registerCommand("todo", {
    description: "Quick todo management",
    handler: async (args, ctx) => {
      if (!args || args.trim() === "") {
        // List todos
        const activeTodos = state.todos.filter(t => !t.completed);
        if (activeTodos.length === 0) {
          ctx.ui.notify("No active todos! 🎉", "info");
          return;
        }

        const todoList = activeTodos
          .sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
          })
          .map(todo => `${todo.id}: ${todo.text}`)
          .join("\n");

        ctx.ui.notify(`Active Todos:\n${todoList}`, "info");
      } else {
        // Add todo
        const newTodo: Todo = {
          id: generateId(),
          text: args.trim(),
          completed: false,
          priority: "medium",
          created: Date.now(),
          tags: []
        };

        state.todos.push(newTodo);
        saveTodos();
        updateStatus(ctx);

        ctx.ui.notify(`Added: "${args.trim()}"`, "success");
      }
    },
  });

  pi.registerCommand("todos-clear", {
    description: "Clear all completed todos",
    handler: async (_args, ctx) => {
      const completedCount = state.todos.filter(t => t.completed).length;
      if (completedCount === 0) {
        ctx.ui.notify("No completed todos to clear", "info");
        return;
      }

      state.todos = state.todos.filter(t => !t.completed);
      saveTodos();
      updateStatus(ctx);

      ctx.ui.notify(`Cleared ${completedCount} completed todos`, "success");
    },
  });

  // Clear status on shutdown
  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("todos", undefined);
    }
  });
}