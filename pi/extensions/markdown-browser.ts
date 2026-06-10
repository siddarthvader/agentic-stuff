import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface DocFile {
  rel: string;
  size: number;
  mtimeMs: number;
  kind: "markdown" | "html";
}

const IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isDocFile(file: string): boolean {
  return /\.(md|markdown|mdown|mkdn|html|htm)$/i.test(file);
}

function isMarkdownFile(file: string): boolean {
  return /\.(md|markdown|mdown|mkdn)$/i.test(file);
}

function isHtmlFile(file: string): boolean {
  return /\.(html|htm)$/i.test(file);
}

function contentTypeFor(file: string): string {
  if (isHtmlFile(file)) return "text/html; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

function listDocFiles(root: string): DocFile[] {
  const out: DocFile[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || !isDocFile(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        out.push({
          rel: path.relative(root, full).split(path.sep).join("/"),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          kind: isHtmlFile(entry.name) ? "html" : "markdown",
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  let paragraph: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length) {
      html.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }

  function closeList(): void {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const item = line.match(/^\s*[-*+]\s+(.*)$/);
    if (item) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(item[1])}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function renderIndex(root: string, files: DocFile[]): string {
  const items = files.map((file) => `
    <li data-path="${escapeHtml(file.rel).toLowerCase()}">
      <a href="/view?path=${encodeURIComponent(file.rel)}">${escapeHtml(file.rel)}</a>
      <span>${file.kind === "html" ? "HTML" : "MD"} · ${formatBytes(file.size)}</span>
    </li>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Docs in ${escapeHtml(path.basename(root))}</title>
  <style>
    body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #d8dee9; background: #111827; }
    header { position: sticky; top: 0; padding: 16px 20px; background: #0b1220; border-bottom: 1px solid #263244; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    .meta { color: #93a4b8; }
    input { width: min(720px, 100%); box-sizing: border-box; margin-top: 12px; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; color: inherit; background: #172033; }
    main { padding: 20px; }
    ul { list-style: none; padding: 0; margin: 0 auto; max-width: 980px; }
    li { display: flex; justify-content: space-between; gap: 16px; padding: 10px 12px; border-bottom: 1px solid #263244; }
    a { color: #8cc7ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    li span { color: #93a4b8; white-space: nowrap; }
    .empty { color: #93a4b8; padding: 24px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Markdown + HTML files</h1>
    <div class="meta">${files.length} docs in ${escapeHtml(root)}</div>
    <input id="q" autofocus placeholder="Filter files…" />
  </header>
  <main>${files.length ? `<ul id="files">${items}</ul>` : `<div class="empty">No markdown or HTML files found.</div>`}</main>
  <script>
    const q = document.getElementById('q');
    const files = [...document.querySelectorAll('#files li')];
    q?.addEventListener('input', () => {
      const needle = q.value.toLowerCase();
      for (const li of files) li.style.display = li.dataset.path.includes(needle) ? '' : 'none';
    });
  </script>
</body>
</html>`;
}

function renderMarkdownView(root: string, rel: string, markdown: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(rel)}</title>
  <style>
    body { margin: 0; font: 16px/1.6 system-ui, sans-serif; color: #d8dee9; background: #111827; }
    nav { position: sticky; top: 0; padding: 12px 20px; background: #0b1220; border-bottom: 1px solid #263244; }
    nav a { color: #8cc7ff; }
    main { max-width: 920px; margin: 0 auto; padding: 24px 32px; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.2; color: #f8fafc; }
    pre { padding: 14px; overflow: auto; border-radius: 10px; background: #020617; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    p code, li code { padding: 2px 5px; border-radius: 5px; background: #020617; }
    blockquote { border-left: 4px solid #475569; margin-left: 0; padding-left: 16px; color: #b6c2d1; }
    .path { color: #93a4b8; margin-left: 10px; }
  </style>
</head>
<body>
  <nav><a href="/">← all docs</a><span class="path">${escapeHtml(rel)} · ${escapeHtml(root)}</span></nav>
  <main>${renderMarkdown(markdown)}</main>
</body>
</html>`;
}

function renderHtmlView(root: string, rel: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(rel)}</title>
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; background: #111827; }
    nav { height: 48px; box-sizing: border-box; padding: 12px 20px; background: #0b1220; border-bottom: 1px solid #263244; color: #d8dee9; }
    nav a { color: #8cc7ff; }
    .path { color: #93a4b8; margin-left: 10px; }
    iframe { display: block; width: 100%; height: calc(100vh - 48px); border: 0; background: white; }
  </style>
</head>
<body>
  <nav><a href="/">← all docs</a><span class="path">${escapeHtml(rel)} · ${escapeHtml(root)}</span></nav>
  <iframe src="/raw?path=${encodeURIComponent(rel)}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>
</body>
</html>`;
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

function openBrowser(pi: ExtensionAPI, url: string): void {
  const cmd = process.platform === "darwin" ? { c: "open", a: [url] } : process.platform === "win32" ? { c: "cmd", a: ["/c", "start", "", url] } : { c: "xdg-open", a: [url] };
  void pi.exec(cmd.c, cmd.a, { timeout: 5000 }).catch(() => undefined);
}

export default function markdownBrowserExtension(pi: ExtensionAPI) {
  let server: http.Server | undefined;
  let url: string | undefined;
  let root = process.cwd();

  async function startServer(): Promise<string> {
    if (server && url) return url;

    server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");

      if (requestUrl.pathname === "/") {
        return send(res, 200, "text/html; charset=utf-8", renderIndex(root, listDocFiles(root)));
      }

      if (requestUrl.pathname === "/view") {
        const rel = requestUrl.searchParams.get("path") ?? "";
        const full = path.resolve(root, rel);
        if (!isInside(root, full) || !isDocFile(full)) {
          return send(res, 400, "text/plain; charset=utf-8", "bad docs path");
        }
        try {
          if (isHtmlFile(full)) return send(res, 200, "text/html; charset=utf-8", renderHtmlView(root, rel));
          return send(res, 200, "text/html; charset=utf-8", renderMarkdownView(root, rel, fs.readFileSync(full, "utf8")));
        } catch (error: any) {
          return send(res, 404, "text/plain; charset=utf-8", error?.message ?? "not found");
        }
      }

      if (requestUrl.pathname === "/raw") {
        const rel = requestUrl.searchParams.get("path") ?? "";
        const full = path.resolve(root, rel);
        if (!isInside(root, full) || !isDocFile(full)) {
          return send(res, 400, "text/plain; charset=utf-8", "bad docs path");
        }
        try {
          return send(res, 200, contentTypeFor(full), fs.readFileSync(full, "utf8"));
        } catch (error: any) {
          return send(res, 404, "text/plain; charset=utf-8", error?.message ?? "not found");
        }
      }

      if (requestUrl.pathname === "/stop") {
        stopServer();
        return send(res, 200, "text/plain; charset=utf-8", "stopped");
      }

      return send(res, 404, "text/plain; charset=utf-8", "not found");
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    return url;
  }

  function stopServer(): void {
    server?.close();
    server = undefined;
    url = undefined;
  }

  pi.registerCommand("markdown-browser", {
    description: "Open a local web server listing markdown and HTML files in the current repo",
    handler: async (_args, ctx) => {
      root = ctx.cwd;
      const viewerUrl = await startServer();
      openBrowser(pi, viewerUrl);
      ctx.ui.notify(`Opened docs browser: ${viewerUrl}`, "info");
    },
  });

  pi.registerCommand("md", {
    description: "Alias for /markdown-browser",
    handler: async (_args, ctx) => {
      root = ctx.cwd;
      const viewerUrl = await startServer();
      openBrowser(pi, viewerUrl);
      ctx.ui.notify(`Opened docs browser: ${viewerUrl}`, "info");
    },
  });

  pi.on("session_shutdown", async () => stopServer());
}
