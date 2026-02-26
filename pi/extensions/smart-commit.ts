import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Change = { status: string; path: string };
const STOP_WORDS = new Set(["const","let","var","function","return","true","false","null","undefined","class","from","import","export","await","async","this","that","with","have","into","your","their","file","files","value","values","string","number","object","array","props","state","data","index"]);

function parseNameStatus(output: string): Change[] {
  return output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    const status = parts[0] || "M";
    const path = status.startsWith("R") && parts.length >= 3 ? parts[2] : parts[1] || "";
    return { status, path };
  }).filter((c) => c.path.length > 0);
}

function inferScope(paths: string[]): string | undefined {
  const buckets = new Map<string, number>();
  for (const p of paths) {
    const seg = p.split("/")[0];
    if (!seg || seg.includes(".")) continue;
    buckets.set(seg, (buckets.get(seg) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [seg, count] of buckets) if (count > bestCount) { best = seg; bestCount = count; }
  return best;
}

function inferType(paths: string[], diffText: string): string {
  const joined = `${paths.join("\n")}\n${diffText}`.toLowerCase();
  const allDocs = paths.length > 0 && paths.every((p) => p.endsWith(".md") || p.startsWith("docs/"));
  if (allDocs || joined.includes("readme") || joined.includes("docs/")) return "docs";
  if (joined.includes("test(") || joined.includes("describe(") || joined.includes(".spec.") || joined.includes(".test.")) return "test";
  if (joined.includes("fix") || joined.includes("bug") || joined.includes("error") || joined.includes("exception") || joined.includes("handle")) return "fix";
  if (joined.includes("refactor") || joined.includes("cleanup") || joined.includes("rename")) return "refactor";
  if (joined.includes("package.json") || joined.includes("lock") || joined.includes("bunfig") || joined.includes("tsconfig")) return "chore";
  return "feat";
}

function extractTheme(diffText: string): string | undefined {
  const freq = new Map<string, number>();
  for (const line of diffText.split("\n")) {
    if ((!line.startsWith("+") && !line.startsWith("-")) || line.startsWith("+++") || line.startsWith("---")) continue;
    const clean = line.slice(1).replace(/[^A-Za-z0-9_\- ]/g, " ").toLowerCase();
    for (const token of clean.split(/\s+/)) {
      if (token.length < 4 || /^\d+$/.test(token) || STOP_WORDS.has(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  return ranked.length ? ranked.join("/") : undefined;
}

function summarizeSubject(paths: string[], diffText: string): string {
  const scope = inferScope(paths);
  const theme = extractTheme(diffText);
  if (paths.length === 1) {
    const file = paths[0];
    if (theme && scope) return `improve ${scope} ${theme} in ${file}`;
    if (theme) return `improve ${theme} in ${file}`;
    return `update ${file}`;
  }
  if (theme && scope) return `improve ${scope} ${theme}`;
  if (theme) return `improve ${theme}`;
  if (scope) return `update ${scope} module`;
  return `update ${paths.length} files`;
}

function buildCommitMessage(nameStatusOutput: string, shortStatOutput: string, diffText: string): string {
  const paths = parseNameStatus(nameStatusOutput).map((c) => c.path);
  const type = inferType(paths, diffText);
  const scope = inferScope(paths);
  const subject = summarizeSubject(paths, diffText);
  const header = `${type}${scope ? `(${scope})` : ""}: ${subject}`;
  const changedPreview = paths.slice(0, 10).map((p) => `- ${p}`).join("\n");
  const maybeMore = paths.length > 10 ? `\n- ...and ${paths.length - 10} more` : "";
  const bodyParts = [shortStatOutput.trim(), changedPreview + maybeMore].filter(Boolean);
  return bodyParts.length ? `${header}\n\n${bodyParts.join("\n")}` : header;
}

async function buildCommitMessageWithAgent(pi: ExtensionAPI, nameStatusOutput: string, shortStatOutput: string, diffText: string): Promise<string | undefined> {
  const prompt = [
    "Write a high-quality conventional commit message.",
    "Return ONLY the commit message text (header + optional body).",
    "Do not add markdown fences.",
    "Prefer clear intent over file listing.",
    "",
    "## Changed files (name-status)",
    nameStatusOutput.trim(),
    "",
    "## Diff shortstat",
    shortStatOutput.trim(),
    "",
    "## Diff excerpt",
    diffText.slice(0, 60000),
  ].join("\n");

  const aiRes = await pi.exec("pi", ["-p", prompt]);
  if (aiRes.code !== 0) return undefined;
  const text = (aiRes.stdout || "").trim();
  return text || undefined;
}

export default function smartCommitExtension(pi: ExtensionAPI) {
  pi.registerCommand("commit", {
    description: "Stage all changes and create a contextual git commit message (or use /commit your message)",
    handler: async (args, ctx) => {
      const hasGit = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
      if (hasGit.code !== 0) return void ctx.ui.notify("Not inside a git repository.", "error");

      const addRes = await pi.exec("git", ["add", "-A"]);
      if (addRes.code !== 0) return void ctx.ui.notify(`git add failed: ${addRes.stderr || addRes.stdout}`, "error");

      const staged = await pi.exec("git", ["diff", "--cached", "--name-status"]);
      if (!staged.stdout.trim()) return void ctx.ui.notify("No changes to commit.", "warning");

      const shortStat = await pi.exec("git", ["diff", "--cached", "--shortstat"]);
      const patch = await pi.exec("git", ["diff", "--cached", "--unified=0", "--no-color"]);
      const diffForAnalysis = (patch.stdout || "").slice(0, 120000);

      const heuristicMessage = buildCommitMessage(staged.stdout, shortStat.stdout, diffForAnalysis);
      const aiMessage = await buildCommitMessageWithAgent(pi, staged.stdout, shortStat.stdout, diffForAnalysis);
      const finalMessage = args?.trim() ? args.trim() : (aiMessage || heuristicMessage);

      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("Create commit?", `Message:\n\n${finalMessage}\n\nProceed with git commit?`);
        if (!ok) return void ctx.ui.notify("Commit cancelled.", "info");
      }

      const commitRes = await pi.exec("git", ["commit", "-m", finalMessage]);
      if (commitRes.code !== 0) return void ctx.ui.notify(`git commit failed: ${commitRes.stderr || commitRes.stdout}`, "error");
      ctx.ui.notify("Committed successfully.", "info");
    },
  });
}
