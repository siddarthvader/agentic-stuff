/**
 * Ask User UI Extension
 *
 * Provides a UI-based tool for the agent to ask clarifying questions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
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
  answers: string[];
  answerLabels: string[];
  choiceIndex?: number;
  choiceIndices: number[];
  wasCustom: boolean;
  customAnswers: string[];
  cancelled: boolean;
  multiSelect: boolean;
  error?: string;
}

interface AskUserSelection {
  answers: string[];
  answerLabels: string[];
  choiceIndices: number[];
  customAnswers: string[];
  wasCustom: boolean;
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
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices (default: false)" })),
});

export default function askUserUiExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user_ui",
    label: "Ask User (UI)",
    description:
      "Ask the user a clarification question using an interactive TUI. Supports optional choices, free-form input, and multi-select.",
    parameters: AskUserParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const allowCustom = params.allowCustom !== false;
      const multiSelect = params.multiSelect === true;
      const choices: NormalizedChoice[] = (params.choices ?? []).map((choice) => ({
        label: choice.label,
        value: choice.value ?? choice.label,
        description: choice.description,
      }));

      const baseDetails: AskUserDetails = {
        question: params.question,
        choices,
        answer: null,
        answers: [],
        answerLabels: [],
        choiceIndices: [],
        wasCustom: false,
        customAnswers: [],
        cancelled: true,
        multiSelect,
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
      const useMultiSelect = multiSelect && hasChoices;

      const result = await ctx.ui.custom<AskUserSelection | null>((tui, theme, _kb, done) => {
        let optionIndex = 0;
        let inputMode = !hasChoices && allowCustom;
        let cachedLines: string[] | undefined;
        const selectedIndices = new Set<number>();
        let customAnswer: string | null = null;
        let customSelected = false;

        const customRowIndex = allowCustom ? displayChoices.length - 1 : -1;
        const submitRowIndex = useMultiSelect ? displayChoices.length : -1;
        const totalRows = displayChoices.length + (useMultiSelect ? 1 : 0);

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

        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function finalizeSelection(selection: AskUserSelection) {
          done(selection);
        }

        function buildMultiSelection(): AskUserSelection {
          const answers: string[] = [];
          const answerLabels: string[] = [];
          const choiceIndices: number[] = [];
          const customAnswers: string[] = [];

          for (let i = 0; i < choices.length; i++) {
            if (selectedIndices.has(i)) {
              answers.push(choices[i].value);
              answerLabels.push(choices[i].label);
              choiceIndices.push(i + 1);
            }
          }

          if (customSelected && customAnswer) {
            answers.push(customAnswer);
            answerLabels.push(customAnswer);
            customAnswers.push(customAnswer);
          }

          return {
            answers,
            answerLabels,
            choiceIndices,
            customAnswers,
            wasCustom: customAnswers.length > 0,
          };
        }

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return;
          }

          if (useMultiSelect) {
            customAnswer = trimmed;
            customSelected = true;
            inputMode = false;
            refresh();
            return;
          }

          finalizeSelection({
            answers: [trimmed],
            answerLabels: [trimmed],
            choiceIndices: [],
            customAnswers: [trimmed],
            wasCustom: true,
          });
        };

        function toggleChoice(index: number) {
          if (selectedIndices.has(index)) {
            selectedIndices.delete(index);
          } else {
            selectedIndices.add(index);
          }
        }

        function handleInput(data: string) {
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              if (hasChoices || useMultiSelect) {
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
            optionIndex = Math.min(totalRows - 1, optionIndex + 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.escape)) {
            done(null);
            return;
          }

          const isSubmitRow = useMultiSelect && optionIndex === submitRowIndex;
          const isCustomRow = allowCustom && optionIndex === customRowIndex;
          const isChoiceRow = optionIndex >= 0 && optionIndex < choices.length;
          const isToggleKey = matchesKey(data, Key.enter) || matchesKey(data, Key.space);

          if (!isToggleKey) {
            return;
          }

          if (isSubmitRow) {
            finalizeSelection(buildMultiSelection());
            return;
          }

          if (isCustomRow) {
            if (useMultiSelect) {
              if (!customAnswer) {
                inputMode = true;
                editor.setText("");
                refresh();
                return;
              }

              if (matchesKey(data, Key.space)) {
                customSelected = !customSelected;
                refresh();
                return;
              }

              inputMode = true;
              editor.setText(customAnswer ?? "");
              refresh();
              return;
            }

            inputMode = true;
            editor.setText("");
            refresh();
            return;
          }

          if (isChoiceRow) {
            if (useMultiSelect) {
              toggleChoice(optionIndex);
              refresh();
              return;
            }

            const selected = choices[optionIndex];
            finalizeSelection({
              answers: [selected.value],
              answerLabels: [selected.label],
              choiceIndices: [optionIndex + 1],
              customAnswers: [],
              wasCustom: false,
            });
          }
        }

        function renderChoiceLine(label: string, selectedRow: boolean, checked: boolean): string {
          const cursor = selectedRow ? theme.fg("accent", "> ") : "  ";
          const checkbox = checked ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
          const textColor = selectedRow ? "accent" : "text";
          return `${cursor}${checkbox} ${theme.fg(textColor, label)}`;
        }

        function renderSingleLine(label: string, selectedRow: boolean): string {
          const cursor = selectedRow ? theme.fg("accent", "> ") : "  ";
          const textColor = selectedRow ? "accent" : "text";
          return `${cursor}${theme.fg(textColor, label)}`;
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const add = (line: string) => lines.push(truncateToWidth(line, width));
          const border = "─".repeat(width);

          add(theme.fg("accent", border));
          for (const line of params.question.split("\n")) {
            const innerWidth = Math.max(1, width - 1);
            for (const wrapped of wrapTextWithAnsi(theme.fg("text", line), innerWidth)) {
              lines.push(` ${wrapped}`);
            }
          }
          lines.push("");

          if (displayChoices.length > 0) {
            for (let i = 0; i < displayChoices.length; i++) {
              const option = displayChoices[i];
              const selectedRow = i === optionIndex;

              if (useMultiSelect) {
                if (option.isCustom) {
                  const label = customAnswer ? `Custom: ${customAnswer}` : option.label;
                  const checked = customSelected && Boolean(customAnswer);
                  add(renderChoiceLine(label, selectedRow, checked));
                } else {
                  const checked = selectedIndices.has(i);
                  add(renderChoiceLine(`${i + 1}. ${option.label}`, selectedRow, checked));
                }
              } else {
                const label = `${i + 1}. ${option.label}`;
                if (option.isCustom && inputMode) {
                  add(renderSingleLine(`${label} ✎`, selectedRow));
                } else {
                  add(renderSingleLine(label, selectedRow));
                }
              }

              if (option.description) {
                add(`     ${theme.fg("muted", option.description)}`);
              }
            }
          }

          if (useMultiSelect) {
            const selectedCount = selectedIndices.size + (customSelected && customAnswer ? 1 : 0);
            const selectedRow = optionIndex === submitRowIndex;
            const label = selectedCount > 0 ? `✓ Submit selections (${selectedCount})` : "✓ Submit selections";
            const line = selectedRow
              ? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
              : theme.fg(selectedCount > 0 ? "success" : "dim", ` ${label} `);
            add(line);
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
            const hint = useMultiSelect
              ? " Enter to save • Esc to cancel input"
              : displayChoices.length > 0
                ? " Enter to submit • Esc to go back"
                : " Enter to submit • Esc to cancel";
            add(theme.fg("dim", hint));
          } else if (useMultiSelect) {
            add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter submit/edit • Esc cancel"));
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
        answer: result?.answers[0] ?? null,
        answerLabel: result?.answerLabels[0],
        answers: result?.answers ?? [],
        answerLabels: result?.answerLabels ?? [],
        choiceIndex: result?.choiceIndices[0],
        choiceIndices: result?.choiceIndices ?? [],
        wasCustom: result?.wasCustom ?? false,
        customAnswers: result?.customAnswers ?? [],
        cancelled: result === null,
        multiSelect,
      };

      if (!result) {
        return {
          content: [{ type: "text", text: "User cancelled the question." }],
          details,
        };
      }

      if (result.answers.length === 0) {
        return {
          content: [{ type: "text", text: "User submitted no selections." }],
          details,
        };
      }

      if (useMultiSelect || result.answers.length > 1) {
        const lines = result.answerLabels.map((label, index) => {
          const value = result.answers[index];
          const isCustom = result.customAnswers.includes(value);
          const valueSuffix = !isCustom && value && value !== label ? ` (value: ${value})` : "";
          return `- ${label}${valueSuffix}${isCustom ? " (custom)" : ""}`;
        });
        return {
          content: [{ type: "text", text: `User selected:\n${lines.join("\n")}` }],
          details,
        };
      }

      if (result.wasCustom) {
        return {
          content: [{ type: "text", text: `User wrote: ${result.answers[0]}` }],
          details,
        };
      }

      const label = result.answerLabels[0] ?? result.answers[0];
      const index = result.choiceIndices[0] ? `${result.choiceIndices[0]}. ` : "";
      const valueSuffix =
        result.answerLabels[0] && result.answerLabels[0] !== result.answers[0]
          ? ` (value: ${result.answers[0]})`
          : "";

      return {
        content: [{ type: "text", text: `User selected: ${index}${label}${valueSuffix}` }],
        details,
      };
    },

    renderCall(args, theme) {
      const question = typeof args.question === "string" ? args.question : "";
      const multiSelect = args.multiSelect === true;
      let text = theme.fg("toolTitle", theme.bold("ask_user_ui ")) + theme.fg("muted", question);
      const rawChoices = Array.isArray(args.choices) ? args.choices : [];
      const allowCustom = args.allowCustom !== false;

      if (multiSelect) {
        text += `\n${theme.fg("dim", "  Mode: multi-select")}`;
      }

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

      if (details.answers.length === 0) {
        return new Text(theme.fg("warning", "No selections"), 0, 0);
      }

      if (details.multiSelect || details.answers.length > 1) {
        const lines = details.answerLabels.map((label, index) => {
          const value = details.answers[index];
          const isCustom = details.customAnswers.includes(value);
          const valueSuffix = !isCustom && value && value !== label ? theme.fg("dim", ` (value: ${value})`) : "";
          const customTag = isCustom ? theme.fg("muted", "(wrote) ") : "";
          return theme.fg("success", "✓ ") + customTag + theme.fg("accent", label) + valueSuffix;
        });
        return new Text(lines.join("\n"), 0, 0);
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
