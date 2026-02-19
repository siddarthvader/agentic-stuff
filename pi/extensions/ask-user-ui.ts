/**
 * Ask User UI Extension
 *
 * Provides a UI-based tool for the agent to ask clarifying questions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface AskChoice {
  label: string;
  value?: string;
  description?: string;
}

interface NormalizedChoice {
  label: string;
  value: string;
  description?: string;
}

interface AskUserDetails {
  question: string;
  choices: NormalizedChoice[];
  answer: string | null;
  answerLabel?: string;
  wasCustom: boolean;
  cancelled: boolean;
  choiceIndex?: number;
  error?: string;
}

interface AskUserSelection {
  answer: string;
  answerLabel: string;
  wasCustom: boolean;
  choiceIndex?: number;
}

const ChoiceSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  value: Type.Optional(Type.String({ description: "Value returned for this option (defaults to label)" })),
  description: Type.Optional(Type.String({ description: "Optional description shown under the label" })),
});

const AskUserParams = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  choices: Type.Optional(Type.Array(ChoiceSchema, { description: "Optional list of choices" })),
  allowCustom: Type.Optional(Type.Boolean({ description: "Allow a custom typed answer (default: true)" })),
});

export default function askUserUiExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user_ui",
    label: "Ask User (UI)",
    description:
      "Ask the user a clarification question using an interactive TUI. Provide optional choices and free-form input.",
    parameters: AskUserParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const allowCustom = params.allowCustom !== false;
      const choices: NormalizedChoice[] = (params.choices ?? []).map((choice) => ({
        label: choice.label,
        value: choice.value ?? choice.label,
        description: choice.description,
      }));

      const baseDetails: AskUserDetails = {
        question: params.question,
        choices,
        answer: null,
        wasCustom: false,
        cancelled: true,
      };

      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "Error: UI not available (interactive mode required)." }],
          details: { ...baseDetails, error: "UI not available" },
        };
      }

      if (choices.length === 0 && !allowCustom) {
        return {
          content: [{ type: "text", text: "Error: No choices provided and custom answers are disabled." }],
          details: { ...baseDetails, error: "No choices and custom answers disabled" },
        };
      }

      const displayChoices: Array<NormalizedChoice & { isCustom?: boolean }> = [...choices];
      if (allowCustom) {
        displayChoices.push({
          label: "Type a custom answer",
          value: "__custom__",
          description: "Provide a free-form response",
          isCustom: true,
        });
      }

      const hasChoices = choices.length > 0;

      const result = await ctx.ui.custom<AskUserSelection | null>((tui, theme, _kb, done) => {
        let optionIndex = 0;
        let inputMode = !hasChoices;
        let cachedLines: string[] | undefined;

        const editorTheme: EditorTheme = {
          borderColor: (s: string) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return;
          }
          done({ answer: trimmed, answerLabel: trimmed, wasCustom: true });
        };

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function handleInput(data: string) {
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              if (hasChoices) {
                inputMode = false;
                editor.setText("");
                refresh();
              } else {
                done(null);
              }
              return;
            }

            editor.handleInput(data);
            refresh();
            return;
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(displayChoices.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter)) {
            const selected = displayChoices[optionIndex];
            if (selected?.isCustom) {
              inputMode = true;
              editor.setText("");
              refresh();
              return;
            }

            if (selected) {
              done({
                answer: selected.value,
                answerLabel: selected.label,
                wasCustom: false,
                choiceIndex: optionIndex + 1,
              });
            }
            return;
          }

          if (matchesKey(data, Key.escape)) {
            done(null);
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const add = (line: string) => lines.push(truncateToWidth(line, width));
          const border = "─".repeat(width);

          add(theme.fg("accent", border));
          for (const line of params.question.split("\n")) {
            add(theme.fg("text", ` ${line}`));
          }
          lines.push("");

          if (hasChoices) {
            for (let i = 0; i < displayChoices.length; i++) {
              const option = displayChoices[i];
              const selected = i === optionIndex;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";
              const label = `${i + 1}. ${option.label}`;

              if (option.isCustom && inputMode) {
                add(prefix + theme.fg("accent", `${label} ✎`));
              } else if (selected) {
                add(prefix + theme.fg("accent", label));
              } else {
                add(`  ${theme.fg("text", label)}`);
              }

              if (option.description) {
                add(`     ${theme.fg("muted", option.description)}`);
              }
            }
          }

          if (inputMode) {
            lines.push("");
            add(theme.fg("muted", " Your answer:"));
            const editorWidth = Math.max(1, width - 2);
            for (const line of editor.render(editorWidth)) {
              add(` ${line}`);
            }
          }

          lines.push("");
          if (inputMode) {
            const hint = hasChoices ? " Enter to submit • Esc to go back" : " Enter to submit • Esc to cancel";
            add(theme.fg("dim", hint));
          } else {
            add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
          }
          add(theme.fg("accent", border));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      const details: AskUserDetails = {
        question: params.question,
        choices,
        answer: result?.answer ?? null,
        answerLabel: result?.answerLabel,
        wasCustom: result?.wasCustom ?? false,
        cancelled: result === null,
        choiceIndex: result?.choiceIndex,
      };

      if (!result) {
        return {
          content: [{ type: "text", text: "User cancelled the question." }],
          details,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `User wrote: ${result.answer}` }],
          details,
        };
      }

      const label = result.answerLabel || result.answer;
      const index = result.choiceIndex ? `${result.choiceIndex}. ` : "";
      const valueSuffix = result.answerLabel && result.answerLabel !== result.answer ? ` (value: ${result.answer})` : "";

      return {
        content: [{ type: "text", text: `User selected: ${index}${label}${valueSuffix}` }],
        details,
      };
    },

    renderCall(args, theme) {
      const question = typeof args.question === "string" ? args.question : "";
      let text = theme.fg("toolTitle", theme.bold("ask_user_ui ")) + theme.fg("muted", question);
      const rawChoices = Array.isArray(args.choices) ? args.choices : [];
      const allowCustom = args.allowCustom !== false;

      if (rawChoices.length > 0) {
        const labels = rawChoices
          .map((choice: AskChoice) => choice.label)
          .concat(allowCustom ? ["Type a custom answer"] : []);
        const numbered = labels.map((label, index) => `${index + 1}. ${label}`).join(", ");
        text += `\n${theme.fg("dim", `  Options: ${truncateToWidth(numbered, 120)}`)}`;
      } else if (allowCustom) {
        text += `\n${theme.fg("dim", "  Free-form answer")}`;
      } else {
        text += `\n${theme.fg("warning", "  No options or custom input available")}`;
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const content = result.content?.[0];
        return new Text(content?.type === "text" ? content.text : "", 0, 0);
      }

      if (details.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", details.answer ?? ""),
          0,
          0,
        );
      }

      const label = details.answerLabel ?? details.answer ?? "";
      const index = details.choiceIndex ? `${details.choiceIndex}. ` : "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", `${index}${label}`), 0, 0);
    },
  });
}
