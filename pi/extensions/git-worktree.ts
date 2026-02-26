import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type RunResult = { code: number; stdout: string; stderr: string };

function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on("error", (err) => {
      resolve({ code: 1, stdout: "", stderr: String(err) });
    });
  });
}

function sanitizeBranchName(name: string): string {
  return name.trim().replace(/^\/+/, "").replace(/\s+/g, "-");
}

function splitArgs(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseWorktreeList(stdout: string): Array<{ path: string; branch: string; head: string; bare: boolean }> {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items: Array<{ path: string; branch: string; head: string; bare: boolean }> = [];
  let current: { path: string; branch: string; head: string; bare: boolean } | null = null;

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (current) items.push(current);
      current = { path: line.slice("worktree ".length).trim(), branch: "", head: "", bare: false };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "").trim();
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  if (current) items.push(current);
  return items;
}

export default function gitWorktreeExtension(pi: ExtensionAPI) {
  pi.registerCommand("worktree", {
    description: "Manage git worktrees: /worktree <branch> | list | go <branch|index> | prune | remove <branch|index>",
    handler: async (args, ctx) => {
      try {
        const originalCwd = ctx.cwd;

        const insideRepo = await run("git", ["rev-parse", "--is-inside-work-tree"], originalCwd);
        if (insideRepo.code !== 0 || insideRepo.stdout !== "true") {
          if (ctx.hasUI) ctx.ui.notify("Not inside a git repository", "error");
          return;
        }

        const rootRes = await run("git", ["rev-parse", "--show-toplevel"], originalCwd);
        if (rootRes.code !== 0 || !rootRes.stdout) {
          if (ctx.hasUI) ctx.ui.notify(`Failed to detect repo root: ${rootRes.stderr || "unknown error"}`, "error");
          return;
        }

        const repoRoot = rootRes.stdout;
        const repoName = path.basename(repoRoot);
        const argv = splitArgs(args || "");

        // /worktree list
        if (argv[0] === "list" || argv[0] === "ls") {
          const listRes = await run("git", ["worktree", "list", "--porcelain"], repoRoot);
          if (listRes.code !== 0) {
            if (ctx.hasUI) ctx.ui.notify(`Failed to list worktrees: ${listRes.stderr || listRes.stdout}`, "error");
            return;
          }

          const items = parseWorktreeList(listRes.stdout);
          if (items.length === 0) {
            if (ctx.hasUI) ctx.ui.notify("No worktrees found", "info");
            return;
          }

          const text = items
            .map((wt, i) => {
              const branch = wt.branch || "(detached)";
              const marker = path.resolve(wt.path) === path.resolve(repoRoot) ? "[main]" : "      ";
              return `${String(i + 1).padStart(2, " ")}. ${marker} ${branch} -> ${wt.path}`;
            })
            .join("\n");

          if (ctx.hasUI) ctx.ui.notify(`Worktrees:\n${text}`, "info");
          return;
        }

        // /worktree prune
        if (argv[0] === "prune") {
          const pruneRes = await run("git", ["worktree", "prune"], repoRoot);
          if (pruneRes.code !== 0) {
            if (ctx.hasUI) ctx.ui.notify(`Failed to prune worktrees: ${pruneRes.stderr || pruneRes.stdout}`, "error");
            return;
          }
          if (ctx.hasUI) ctx.ui.notify("Pruned stale worktree metadata", "success");
          return;
        }

        // /worktree go <branch|index>
        if (argv[0] === "go") {
          const target = (argv[1] || "").trim();
          if (!target) {
            if (ctx.hasUI) ctx.ui.notify("Usage: /worktree go <branch|index>", "error");
            return;
          }

          const listRes = await run("git", ["worktree", "list", "--porcelain"], repoRoot);
          if (listRes.code !== 0) {
            if (ctx.hasUI) ctx.ui.notify(`Failed to list worktrees: ${listRes.stderr || listRes.stdout}`, "error");
            return;
          }

          const items = parseWorktreeList(listRes.stdout);
          let match = items.find((wt) => wt.branch === target || wt.path.endsWith(`-${target}`));
          const index = Number(target);
          if (!match && Number.isFinite(index) && index >= 1 && index <= items.length) {
            match = items[index - 1];
          }

          if (!match) {
            if (ctx.hasUI) ctx.ui.notify(`No worktree found for '${target}'. Try /worktree list`, "error");
            return;
          }

          if (ctx.hasUI) {
            ctx.ui.notify(`Run: cd ${match.path}\nThen restart pi there (or /new from that shell).`, "info");
          }
          return;
        }

        // /worktree remove <branch|index>
        if (argv[0] === "remove" || argv[0] === "rm") {
          const target = (argv[1] || "").trim();
          if (!target) {
            if (ctx.hasUI) ctx.ui.notify("Usage: /worktree remove <branch|index>", "error");
            return;
          }

          const listRes = await run("git", ["worktree", "list", "--porcelain"], repoRoot);
          if (listRes.code !== 0) {
            if (ctx.hasUI) ctx.ui.notify(`Failed to list worktrees: ${listRes.stderr || listRes.stdout}`, "error");
            return;
          }

          const items = parseWorktreeList(listRes.stdout);
          let match = items.find((wt) => wt.branch === target || wt.path.endsWith(`-${target}`));
          const index = Number(target);
          if (!match && Number.isFinite(index) && index >= 1 && index <= items.length) {
            match = items[index - 1];
          }

          if (!match) {
            if (ctx.hasUI) ctx.ui.notify(`No worktree found for '${target}'.`, "error");
            return;
          }

          if (path.resolve(match.path) === path.resolve(repoRoot)) {
            if (ctx.hasUI) ctx.ui.notify("Cannot remove main worktree", "error");
            return;
          }

          const rmRes = await run("git", ["worktree", "remove", match.path], repoRoot);
          if (rmRes.code !== 0) {
            if (ctx.hasUI) ctx.ui.notify(`Failed to remove worktree: ${rmRes.stderr || rmRes.stdout}`, "error");
            return;
          }

          if (ctx.hasUI) ctx.ui.notify(`Removed worktree ${match.path}`, "success");
          return;
        }

        // default: /worktree <branch>
        const branch = sanitizeBranchName((args || "").trim());
        if (!branch) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /worktree <branch> | list | go <branch|index> | remove <branch|index> | prune",
              "error",
            );
          }
          return;
        }

        const safeBranchSegment = branch.replace(/[\/]+/g, "-");
        const worktreePath = path.resolve(repoRoot, "..", `${repoName}-${safeBranchSegment}`);

        const branchExists = await run("git", ["show-ref", "--verify", `refs/heads/${branch}`], repoRoot);
        const addArgs =
          branchExists.code === 0
            ? ["worktree", "add", worktreePath, branch]
            : ["worktree", "add", "-b", branch, worktreePath];

        const addRes = await run("git", addArgs, repoRoot);
        if (addRes.code !== 0) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Failed to create worktree: ${addRes.stderr || addRes.stdout || "unknown error"}`, "error");
          }
          return;
        }

        if (ctx.hasUI) {
          ctx.ui.notify(
            `Created '${branch}' at ${worktreePath}\nNext: cd ${worktreePath} && pi`,
            "success",
          );
        }
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Worktree command failed: ${String(error)}`, "error");
        }
      }
    },
  });
}
