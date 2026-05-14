import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

function parseDuration(arg?: string): number | undefined {
  if (!arg) return undefined;
  const n = Number(arg);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(120, Math.floor(n)));
}

function parseAudioArgs(args?: string): { duration?: number; stopPhrase: string } {
  const raw = (args || "").trim();
  if (!raw) return { stopPhrase: "stop gandu" };

  const parts = raw.split(/\s+/);
  const duration = parseDuration(parts[0]);
  const stopPhrase = (duration ? parts.slice(1) : parts).join(" ").trim() || "stop gandu";
  return { duration, stopPhrase };
}

type ActiveRecording = {
  child: ChildProcessWithoutNullStreams;
  wavPath: string;
  stopPhrase: string;
  apiKey: string;
  stderr: string;
  transcribing: boolean;
  timer?: NodeJS.Timeout;
};

let activeRecording: ActiveRecording | undefined;

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
  async function transcribeRecording(recording: ActiveRecording, ctx: any) {
    if (recording.transcribing) return;
    recording.transcribing = true;
    if (recording.timer) clearTimeout(recording.timer);

    try {
      if (!existsSync(recording.wavPath) || statSync(recording.wavPath).size < 1024) {
        ctx.ui.notify("Recording was empty. Check mic input/permissions.", "error");
        if (recording.stderr.trim()) pi.sendUserMessage(`Audio recording error:\n${recording.stderr.trim()}`);
        return;
      }

      ctx.ui.notify("Transcribing...", "info");

      const audioBytes = readFileSync(recording.wavPath);
      const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
      const form = new FormData();
      form.append("file", audioBlob, "audio.wav");
      form.append("model", "gpt-4o-mini-transcribe");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${recording.apiKey}` },
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

      if (recording.stopPhrase && transcript.toLowerCase().includes(recording.stopPhrase.toLowerCase())) {
        ctx.ui.notify(`Stop phrase detected: \"${recording.stopPhrase}\"`, "info");
        return;
      }

      pi.sendUserMessage(transcript);
      ctx.ui.notify("Transcript inserted into chat.", "info");
    } catch (error: any) {
      ctx.ui.notify(`Audio command failed: ${error?.message ?? String(error)}`, "error");
    } finally {
      try {
        if (existsSync(recording.wavPath)) unlinkSync(recording.wavPath);
      } catch {
        // ignore cleanup failures
      }
      if (activeRecording === recording) activeRecording = undefined;
    }
  }

  function stopActiveRecording(ctx: any) {
    const recording = activeRecording;
    if (!recording) {
      ctx.ui.notify("No active recording found.", "warning");
      return;
    }
    ctx.ui.notify("Stopping recording...", "info");
    recording.child.kill("SIGINT");
    setTimeout(() => {
      if (activeRecording === recording && !recording.child.killed) recording.child.kill("SIGTERM");
    }, 1500).unref();
  }

  pi.registerCommand("audio-stop", {
    description: "Stop active audio recording and transcribe it",
    handler: async (_args, ctx) => stopActiveRecording(ctx),
  });

  pi.registerCommand("audio", {
    description: "Record mic audio until /audio-stop, then transcribe (/audio [stop phrase]; optional: /audio [seconds] [stop phrase])",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      if (activeRecording) {
        ctx.ui.notify("Already recording. Use /audio-stop when done.", "warning");
        return;
      }

      const apiKey = await resolveOpenAIApiKey(ctx);
      if (!apiKey) {
        const provider = ctx.model?.provider ? ` Current model provider: ${ctx.model.provider}.` : "";
        ctx.ui.notify(`No usable API key found (env or Pi auth).${provider}`, "error");
        return;
      }

      const { duration, stopPhrase } = parseAudioArgs(args);
      const wavPath = join(tmpdir(), `pi-audio-${Date.now()}.wav`);

      const recorder = spawnSync("bash", ["-lc", "command -v rec || command -v arecord || command -v ffmpeg"], {
        encoding: "utf8",
      }).stdout.trim().split("\n")[0];

      if (!recorder) {
        ctx.ui.notify("No recorder found (install sox/rec, alsa-utils/arecord, or ffmpeg).", "error");
        return;
      }

      const command = recorder.endsWith("/rec") || recorder === "rec"
        ? recorder
        : recorder.endsWith("/arecord") || recorder === "arecord"
          ? recorder
          : recorder;
      const recorderName = command.split("/").pop();
      const child = recorderName === "rec"
        ? spawn(command, ["-q", "-c", "1", "-r", "16000", wavPath])
        : recorderName === "arecord"
          ? spawn(command, ["-q", "-f", "S16_LE", "-c", "1", "-r", "16000", wavPath])
          : spawn(command, ["-hide_banner", "-loglevel", "error", "-f", "pulse", "-i", "default", "-ac", "1", "-ar", "16000", wavPath]);

      const recording: ActiveRecording = {
        child,
        wavPath,
        stopPhrase,
        apiKey,
        stderr: "",
        transcribing: false,
      };
      activeRecording = recording;

      child.stderr.on("data", (chunk) => {
        recording.stderr += String(chunk);
      });

      child.on("close", () => {
        void transcribeRecording(recording, ctx);
      });

      child.on("error", (error) => {
        recording.stderr += error.message;
      });

      if (duration) {
        recording.timer = setTimeout(() => stopActiveRecording(ctx), duration * 1000);
        ctx.ui.notify(`Recording for ${duration}s... Use /audio-stop to finish early.`, "info");
      } else {
        ctx.ui.notify("Recording... run /audio-stop when done.", "info");
      }
    },
  });
}
