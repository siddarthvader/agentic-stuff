import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, "web");
const htmxPath = path.join(__dirname, "..", "..", "..", "node_modules", "htmx.org", "dist", "htmx.min.js");
const ssePath = path.join(__dirname, "..", "..", "..", "node_modules", "htmx-ext-sse", "sse.js");

type ContentPart = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
type MessageEntry = { type: "message"; id: string; message: { role: string; content?: unknown; provider?: string; model?: string; timestamp?: number } };
type ViewBlock = { id: string; role: "user" | "thinking" | "assistant"; title: string; meta: string; time: string; text: string };
type Trace = { entryId: string; timestamp?: number; provider?: string; model?: string; thinking: string };

type Snapshot = { blocks: ViewBlock[]; updatedAt: number; sessionFile?: string };
type Client = http.ServerResponse;

function isPart(part: unknown): part is ContentPart {
	return !!part && typeof part === "object" && typeof (part as { type?: unknown }).type === "string";
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(isPart).map((part) => {
		if (part.type === "text") return part.text ?? "";
		if (part.type === "thinking") return part.thinking ?? "";
		if (part.type === "toolCall") return `Tool call: ${part.name ?? "unknown"}\n${JSON.stringify(part.arguments ?? {}, null, 2)}`;
		return "";
	}).filter(Boolean).join("\n\n");
}

function collectThinkingFromBranch(branch: unknown[], lastOnly: boolean): Trace[] {
	const traces: Trace[] = [];
	for (const entry of branch as MessageEntry[]) {
		if (!entry || entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const thinking = message.content
			.filter((part): part is ContentPart => isPart(part) && part.type === "thinking" && typeof part.thinking === "string")
			.map((part) => part.thinking!.trim())
			.filter(Boolean)
			.join("\n\n");
		if (thinking) traces.push({ entryId: entry.id, timestamp: message.timestamp, provider: message.provider, model: message.model, thinking });
	}
	return lastOnly ? traces.slice(-1) : traces;
}

function formatTimestamp(timestamp?: number): string {
	if (!timestamp) return "unknown time";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "2-digit",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
	}).format(new Date(timestamp));
}

function collectBlocksFromBranch(branch: unknown[], lastOnly: boolean): ViewBlock[] {
	const traceIds = new Set(collectThinkingFromBranch(branch, lastOnly).map((trace) => trace.entryId));
	const blocks: ViewBlock[] = [];
	for (const entry of branch as MessageEntry[]) {
		if (!entry || entry.type !== "message") continue;
		const { message } = entry;
		const when = formatTimestamp(message.timestamp);
		if (message.role === "user") {
			blocks.push({ id: entry.id, role: "user", title: "User message", meta: entry.id, time: when, text: textFromContent(message.content) });
			continue;
		}
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const model = [message.provider, message.model].filter(Boolean).join("/") || "unknown model";
		const thinking = message.content.filter((p): p is ContentPart => isPart(p) && p.type === "thinking" && typeof p.thinking === "string").map((p) => p.thinking!.trim()).filter(Boolean).join("\n\n");
		const visible = message.content.filter((p): p is ContentPart => isPart(p) && p.type === "text" && typeof p.text === "string").map((p) => p.text!.trim()).filter(Boolean).join("\n\n");
		if (thinking && (!lastOnly || traceIds.has(entry.id))) blocks.push({ id: `${entry.id}:thinking`, role: "thinking", title: "Thinking trace", meta: `${entry.id} · ${model}`, time: when, text: thinking });
		if (visible) blocks.push({ id: `${entry.id}:assistant`, role: "assistant", title: "Visible response", meta: `${entry.id} · ${model}`, time: when, text: visible });
	}
	return blocks;
}

function formatTrace(traces: Trace[], includeMetadata: boolean): string {
	if (traces.length === 0) return "No thinking trace blocks found in the current branch.";
	return traces.map((trace, index) => {
		if (!includeMetadata) return trace.thinking;
		const when = formatTimestamp(trace.timestamp);
		const model = [trace.provider, trace.model].filter(Boolean).join("/") || "unknown model";
		return `## Thinking trace ${index + 1} (${trace.entryId}, ${model}, ${when})\n\n${trace.thinking}`;
	}).join("\n\n---\n\n");
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function withCodeSpans(escaped: string): string {
	return escaped.replace(/```([\s\S]*?)```/g, '<span class="code-block">```$1```</span>');
}

function wants(url: URL, name: string): boolean { return url.searchParams.get(name) === "on"; }

function renderBlocks(snapshot: Snapshot, requestUrl = "/blocks"): string {
	const url = new URL(requestUrl, "http://localhost");
	const showThinking = wants(url, "thinking") || !url.search;
	const showUser = wants(url, "user") || !url.search;
	const showAssistant = wants(url, "assistant") || !url.search;
	const showCode = wants(url, "code") || !url.search;
	const q = (url.searchParams.get("q") ?? "").toLowerCase();
	const blocks = snapshot.blocks.filter((block) => {
		if (block.role === "thinking" && !showThinking) return false;
		if (block.role === "user" && !showUser) return false;
		if (block.role === "assistant" && !showAssistant) return false;
		return !q || `${block.title} ${block.meta} ${block.time} ${block.text}`.toLowerCase().includes(q);
	});
	const body = blocks.length === 0 ? '<section class="empty">No matching blocks.</section>' : blocks.map((block) => `
		<section class="block ${block.role}">
			<header><div><div class="title">${escapeHtml(block.title)}</div><div class="meta">${escapeHtml(block.meta)}</div></div><time>${escapeHtml(block.time)}</time></header>
			<pre>${withCodeSpans(escapeHtml(block.text))}</pre>
		</section>`).join("");
	return `<div class="${showCode ? "" : "code-hidden"}">${body}</div>`;
}

function renderStatus(snapshot: Snapshot, clientCount: number): string {
	const thinkingCount = snapshot.blocks.filter((block) => block.role === "thinking").length;
	return `<span id="status" sse-swap="status" hx-swap="outerHTML">${thinkingCount} traces · ${snapshot.blocks.length} blocks · ${clientCount} clients · ${formatTimestamp(snapshot.updatedAt)}</span>`;
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string | Buffer): void {
	res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
	res.end(body);
}

function openBrowser(pi: ExtensionAPI, url: string): void {
	const cmd = process.platform === "darwin" ? { c: "open", a: [url] } : process.platform === "win32" ? { c: "cmd", a: ["/c", "start", "", url] } : { c: "xdg-open", a: [url] };
	void pi.exec(cmd.c, cmd.a, { timeout: 5000 }).catch(() => undefined);
}

export default function thinkingTraceExtension(pi: ExtensionAPI) {
	let snapshot: Snapshot = { blocks: [], updatedAt: Date.now() };
	let server: http.Server | undefined;
	let url: string | undefined;
	const clients = new Set<Client>();

	function broadcast(): void {
		const chunks = [`event: status\ndata: ${renderStatus(snapshot, clients.size)}\n\n`, "event: refresh\ndata: ok\n\n"];
		for (const client of clients) chunks.forEach((chunk) => client.write(chunk));
	}

	function update(ctx: { sessionManager: { getBranch(): unknown[]; getSessionFile?(): string | undefined } }): void {
		snapshot = { blocks: collectBlocksFromBranch(ctx.sessionManager.getBranch(), false), updatedAt: Date.now(), sessionFile: ctx.sessionManager.getSessionFile?.() };
		broadcast();
	}

	async function startServer(): Promise<string> {
		if (server && url) return url;
		server = http.createServer((req, res) => {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			if (requestUrl.pathname === "/") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(webDir, "index.html")));
			if (requestUrl.pathname === "/style.css") return send(res, 200, "text/css; charset=utf-8", fs.readFileSync(path.join(webDir, "style.css")));
			if (requestUrl.pathname === "/htmx.min.js") return send(res, 200, "application/javascript; charset=utf-8", fs.readFileSync(htmxPath));
			if (requestUrl.pathname === "/sse.js") return send(res, 200, "application/javascript; charset=utf-8", fs.readFileSync(ssePath));
			if (requestUrl.pathname === "/blocks") return send(res, 200, "text/html; charset=utf-8", renderBlocks(snapshot, requestUrl.toString()));
			if (requestUrl.pathname === "/events") {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
				clients.add(res);
				res.write(`event: status\ndata: ${renderStatus(snapshot, clients.size)}\n\n`);
				res.write("event: refresh\ndata: ok\n\n");
				req.on("close", () => { clients.delete(res); broadcast(); });
				return;
			}
			if (requestUrl.pathname === "/stop") { stopServer(); return send(res, 200, "text/plain", "stopped"); }
			return send(res, 404, "text/plain", "not found");
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
		for (const client of clients) client.end();
		clients.clear();
		server?.close();
		server = undefined;
		url = undefined;
	}

	pi.registerTool({
		name: "read_thinking_trace",
		label: "Read Thinking Trace",
		description: "Read only assistant thinking/reasoning trace blocks from the current session branch. Returns no normal assistant text or tool output.",
		promptSnippet: "Read only assistant thinking/reasoning trace blocks from the current session branch.",
		parameters: Type.Object({ lastOnly: Type.Optional(Type.Boolean()), includeMetadata: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const traces = collectThinkingFromBranch(ctx.sessionManager.getBranch(), params.lastOnly === true);
			return { content: [{ type: "text", text: formatTrace(traces, params.includeMetadata !== false) }], details: { count: traces.length } };
		},
	});

	pi.registerCommand("thinking-trace", {
		description: "Open the live thinking trace viewer",
		handler: async (_args, ctx) => {
			update(ctx);
			const viewerUrl = await startServer();
			openBrowser(pi, viewerUrl);
			ctx.ui.notify(`Opened thinking trace viewer: ${viewerUrl}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => update(ctx));
	pi.on("message_end", async (_event, ctx) => update(ctx));
	pi.on("turn_end", async (_event, ctx) => update(ctx));
	pi.on("session_shutdown", async () => stopServer());
}
