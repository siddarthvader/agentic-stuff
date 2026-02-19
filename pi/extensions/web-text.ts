/**
 * Web Text Extension
 *
 * Fetches text-only content from URLs and performs basic web searches.
 * Uses DuckDuckGo's HTML results for search (no API key required).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WebTextParams = Type.Object({
  action: StringEnum(["fetch", "search"] as const),
  url: Type.Optional(Type.String({ description: "URL to fetch (required for fetch)" })),
  query: Type.Optional(Type.String({ description: "Search query (required for search)" })),
  timeoutMs: Type.Optional(
    Type.Number({ description: "Timeout in milliseconds (default: 15000)" })
  ),
});

type WebTextAction = "fetch" | "search";

interface WebTextDetails {
  action: WebTextAction;
  url?: string;
  query?: string;
  finalUrl?: string;
  status?: number;
  contentType?: string | null;
  resultCount?: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  return text.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, (entity) => {
    if (named[entity]) return named[entity];
    if (entity.startsWith("&#x")) {
      const code = parseInt(entity.slice(3, -1), 16);
      return Number.isNaN(code) ? entity : String.fromCharCode(code);
    }
    if (entity.startsWith("&#")) {
      const code = parseInt(entity.slice(2, -1), 10);
      return Number.isNaN(code) ? entity : String.fromCharCode(code);
    }
    return entity;
  });
}

function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--([\s\S]*?)-->/g, "");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?p[^>]*>/gi, "\n");
  text = text.replace(/<\/?div[^>]*>/gi, "\n");
  text = text.replace(/<\/?h[1-6][^>]*>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "\n");

  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function getAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId), { once: true });

  if (!signal) return controller.signal;

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, controller.signal]);
  }

  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller.signal;
}

function applyTruncation(output: string): {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
} {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "pi-web-text-"));
  const tempFile = join(tempDir, "output.txt");
  writeFileSync(tempFile, output);

  let resultText = truncation.content;
  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

  resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
  resultText += ` Full output saved to: ${tempFile}]`;

  return {
    text: resultText,
    truncation,
    fullOutputPath: tempFile,
  };
}

function extractSearchResults(html: string): Array<{ title: string; url: string; snippet?: string }> {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html))) {
    const url = match[1];
    const title = htmlToText(match[2]);

    const slice = html.slice(match.index, match.index + 3000);
    const snippetMatch = slice.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]) : undefined;

    if (title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

export default function webTextExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_text",
    label: "Web Text",
    description: `Fetch URL text or run a web search (DuckDuckGo HTML). Returns text-only content (no images). Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: WebTextParams,

    async execute(_toolCallId, params, signal) {
      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      if (params.action === "fetch") {
        if (!params.url) {
          return {
            content: [{ type: "text", text: "Error: url is required for fetch." }],
            details: { action: "fetch", error: "Missing url" } satisfies WebTextDetails,
          };
        }

        const url = normalizeUrl(params.url);
        const abortSignal = getAbortSignal(signal, timeoutMs);

        try {
          const response = await fetch(url, {
            method: "GET",
            redirect: "follow",
            headers: {
              "User-Agent": "pi-web-text/1.0 (+https://github.com/badlogic/pi-mono)",
              Accept: "text/html, text/plain;q=0.9, */*;q=0.8",
            },
            signal: abortSignal,
          });

          const body = await response.text();
          const text = htmlToText(body);
          const truncation = applyTruncation(text);

          const details: WebTextDetails = {
            action: "fetch",
            url,
            finalUrl: response.url,
            status: response.status,
            contentType: response.headers.get("content-type"),
            truncation: truncation.truncation,
            fullOutputPath: truncation.fullOutputPath,
          };

          return {
            content: [{ type: "text", text: truncation.text }],
            details,
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error fetching URL: ${error?.message ?? String(error)}` }],
            details: { action: "fetch", url, error: error?.message ?? String(error) } satisfies WebTextDetails,
          };
        }
      }

      if (!params.query) {
        return {
          content: [{ type: "text", text: "Error: query is required for search." }],
          details: { action: "search", error: "Missing query" } satisfies WebTextDetails,
        };
      }

      const query = params.query.trim();
      const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const abortSignal = getAbortSignal(signal, timeoutMs);

      try {
        const response = await fetch(searchUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent": "pi-web-text/1.0 (+https://github.com/badlogic/pi-mono)",
            Accept: "text/html, text/plain;q=0.9, */*;q=0.8",
          },
          signal: abortSignal,
        });

        const body = await response.text();
        const results = extractSearchResults(body);

        let output = "";
        if (results.length === 0) {
          output = "No search results found.";
        } else {
          output = results
            .slice(0, 10)
            .map((result, index) => {
              const snippet = result.snippet ? `\n   ${result.snippet}` : "";
              return `${index + 1}. ${result.title}\n   ${result.url}${snippet}`;
            })
            .join("\n\n");
        }

        const truncation = applyTruncation(output);
        const details: WebTextDetails = {
          action: "search",
          query,
          finalUrl: response.url,
          status: response.status,
          contentType: response.headers.get("content-type"),
          resultCount: results.length,
          truncation: truncation.truncation,
          fullOutputPath: truncation.fullOutputPath,
        };

        return {
          content: [{ type: "text", text: truncation.text }],
          details,
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error running search: ${error?.message ?? String(error)}` }],
          details: { action: "search", query, error: error?.message ?? String(error) } satisfies WebTextDetails,
        };
      }
    },

    renderCall(args, theme) {
      const action = args.action === "search" ? "search" : "fetch";
      let text = theme.fg("toolTitle", theme.bold("web_text "));
      text += theme.fg("accent", action);
      if (args.url) {
        text += theme.fg("muted", ` ${args.url}`);
      }
      if (args.query) {
        text += theme.fg("muted", ` \"${args.query}\"`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Fetching..."), 0, 0);
      }

      const details = result.details as WebTextDetails | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `❌ ${details.error}`), 0, 0);
      }

      let text = theme.fg("success", "✓ Done");
      if (details?.truncation?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }

      if (expanded && details?.fullOutputPath) {
        text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
      }

      return new Text(text, 0, 0);
    },
  });
}
