import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseDuration(arg?: string): number {
  const n = Number(arg ?? "10");
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(120, Math.floor(n)));
}

function parseAudioArgs(args?: string): { duration: number; stopPhrase: string } {
  const raw = (args || "").trim();
  if (!raw) return { duration: 10, stopPhrase: "stop gandu" };

  const parts = raw.split(/\s+/);
  const duration = parseDuration(parts[0]);
  const stopPhrase = parts.slice(1).join(" ").trim() || "stop gandu";
  return { duration, stopPhrase };
}

async function resolveOpenAIApiKey(ctx: any): Promise<string | undefined> {
  const envKey = process.env.OPENAI_API_KEY?.trim() || process.env.PI_AUDIO_API_KEY?.trim();
  if (envKey) return envKey;

  try {
    const currentModel = ctx.model;
    if (currentModel?.provider) {
      const currentKey = await ctx.modelRegistry.getApiKey(currentModel);
      if (currentKey) return currentKey;
    }

    const models = await ctx.modelRegistry.getAvailable();
    const preferred = models.find((m: any) => m.provider === "openai")
      || models.find((m: any) => String(m.provider).includes("openai"))
      || models.find((m: any) => String(m.provider).includes("chatgpt"))
      || models.find((m: any) => String(m.provider).includes("codex"));

    if (!preferred) return undefined;
    return await ctx.modelRegistry.getApiKey(preferred);
  } catch {
    return undefined;
  }
}

export default function audioTranscribeExtension(pi: ExtensionAPI) {
  pi.registerCommand("audio-stop", {
    description: "Stop any active audio recording process",
    handler: async (_args, ctx) => {
      const kill = await pi.exec("bash", [
        "-lc",
        "pkill -f '(^|/)rec( |$)|(^|/)arecord( |$)|ffmpeg.*-f pulse' 2>/dev/null || true",
      ]);
      if (kill.code === 0) ctx.ui.notify("Stopped active recording (if any).", "info");
      else ctx.ui.notify("No active recording found.", "warning");
    },
  });

  pi.registerCommand("audio", {
    description: "Record mic audio and transcribe it (/audio [seconds] [stop phrase], default: /audio 10 stop gandu)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      const apiKey = await resolveOpenAIApiKey(ctx);
      if (!apiKey) {
        const provider = ctx.model?.provider ? ` Current model provider: ${ctx.model.provider}.` : "";
        ctx.ui.notify(`No usable API key found (env or Pi auth).${provider}`, "error");
        return;
      }

      const { duration, stopPhrase } = parseAudioArgs(args);
      const wavPath = join(tmpdir(), `pi-audio-${Date.now()}.wav`);

      try {
        ctx.ui.notify(`Recording for ${duration}s...`, "info");

        const recResult = await pi.exec(
          "bash",
          [
            "-lc",
            [
              `if command -v rec >/dev/null 2>&1; then rec -q -c 1 -r 16000 \"${wavPath}\" trim 0 ${duration}; exit $?; fi`,
              `if command -v arecord >/dev/null 2>&1; then arecord -q -f S16_LE -c 1 -r 16000 -d ${duration} \"${wavPath}\"; exit $?; fi`,
              `if command -v ffmpeg >/dev/null 2>&1; then ffmpeg -hide_banner -loglevel error -f pulse -i default -ac 1 -ar 16000 -t ${duration} \"${wavPath}\"; exit $?; fi`,
              "echo 'No recorder found (rec/arecord/ffmpeg)' >&2",
              "exit 127",
            ].join("; "),
          ],
          { timeout: duration + 8 },
        );

        if (recResult.code !== 0 || !existsSync(wavPath)) {
          const details = (recResult.stderr || recResult.stdout || "").trim();
          ctx.ui.notify("Recording failed (need rec/arecord/ffmpeg + mic permission).", "error");
          if (details) pi.sendUserMessage(`Audio recording error:\n${details}`);
          return;
        }

        ctx.ui.notify("Transcribing...", "info");

        const audioBytes = readFileSync(wavPath);
        const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
        const form = new FormData();
        form.append("file", audioBlob, "audio.wav");
        form.append("model", "gpt-4o-mini-transcribe");

        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        });

        if (!res.ok) {
          const errText = await res.text();
          ctx.ui.notify(`Transcription failed: ${res.status}`, "error");
          pi.sendUserMessage(`Transcription API error:\n${errText}`);
          return;
        }

        const data = (await res.json()) as { text?: string };
        const transcript = (data.text ?? "").trim();

        if (!transcript) {
          ctx.ui.notify("No speech detected.", "warning");
          return;
        }

        if (stopPhrase && transcript.toLowerCase().includes(stopPhrase.toLowerCase())) {
          ctx.ui.notify(`Stop phrase detected: \"${stopPhrase}\"`, "info");
          return;
        }

        pi.sendUserMessage(transcript);
        ctx.ui.notify("Transcript inserted into chat.", "info");
      } catch (error: any) {
        ctx.ui.notify(`Audio command failed: ${error?.message ?? String(error)}`, "error");
      } finally {
        try {
          if (existsSync(wavPath)) unlinkSync(wavPath);
        } catch {
          // ignore cleanup failures
        }
      }
    },
  });
}
