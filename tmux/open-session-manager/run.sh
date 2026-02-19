#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

ACTION_FILE="$(mktemp /tmp/open-session-manager-action.XXXXXX)"
DEBUG_LOG="${OSM_DEBUG_LOG:-}"
trap 'rm -f "$ACTION_FILE"' EXIT

log() {
  [[ -z "$DEBUG_LOG" ]] && return 0
  printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$DEBUG_LOG"
}

if ! OSM_ACTION_FILE="$ACTION_FILE" bun run src/main.tsx picker; then
  log "picker crashed"
  tmux display-message "open-session-manager: picker crashed"
  exit 1
fi

if [[ ! -s "$ACTION_FILE" ]]; then
  exit 0
fi

action="$(cut -d '|' -f1 "$ACTION_FILE")"
target="$(cut -d '|' -f2- "$ACTION_FILE")"
log "action=$action target=$target"

resolve_parent_session() {
  local sess="$1"
  local candidate="$sess"

  # Handle popup-* prefix case-insensitively.
  if [[ "${candidate,,}" == popup-* ]]; then
    candidate="${candidate:6}"
  fi

  if tmux has-session -t "$candidate" 2>/dev/null; then
    printf '%s' "$candidate"
    return 0
  fi

  local hit
  hit="$(tmux list-sessions -F '#{session_name}' | awk -v c="${candidate,,}" '{if (tolower($0)==c) {print; exit}}')"
  [[ -n "$hit" ]] && printf '%s' "$hit"
}

resolve_parent_pane() {
  local t="$1"
  local sessionPart="${t%%:*}"
  local winPane="${t#*:}"
  local win="${winPane%%.*}"
  local pane="${winPane#*.}"
  local parent

  parent="$(resolve_parent_session "$sessionPart")"
  [[ -z "$parent" ]] && return 1

  local exact="${parent}:${win}.${pane}"
  if tmux list-panes -t "$parent" -F '#{session_name}:#{window_index}.#{pane_index}' | grep -Fxq "$exact"; then
    printf '%s' "$exact"
    return 0
  fi

  local sameWin="${parent}:${win}.0"
  if tmux list-panes -t "$parent" -F '#{session_name}:#{window_index}.#{pane_index}' | grep -Fxq "$sameWin"; then
    printf '%s' "$sameWin"
    return 0
  fi

  tmux list-panes -t "$parent" -F '#{session_name}:#{window_index}.#{pane_index}' | head -n1
}

run_after_popup_closes() {
  local script_body="$1"
  local script_file
  script_file="$(mktemp /tmp/open-session-manager-dispatch.XXXXXX)"

  {
    echo '#!/usr/bin/env bash'
    echo 'set -euo pipefail'
    echo 'sleep 0.08'
    echo "$script_body"
    printf 'rm -f %q\n' "$script_file"
  } > "$script_file"

  chmod +x "$script_file"
  log "dispatch script=$script_file"
  tmux run-shell -b "bash $(printf '%q' "$script_file")"
}

case "$action" in
  switch)
    log "queue switch target=$target"
    qt="$(printf '%q' "$target")"
    run_after_popup_closes "tmux switch-client -t $qt
 tmux select-pane -t $qt"
    ;;
  parent)
    sess="${target%%:*}"
    parent="$(resolve_parent_session "$sess")"
    if [[ -n "$parent" ]]; then
      log "queue parent target=$target parent=$parent"
      qp="$(printf '%q' "$parent")"
      run_after_popup_closes "tmux switch-client -t $qp"
    else
      log "parent not found target=$target"
      tmux display-message "open-session-manager: parent not found for $sess"
    fi
    ;;
  lazygit)
    pane="$(resolve_parent_pane "$target" || true)"
    if [[ -n "$pane" ]]; then
      log "queue lazygit target=$target pane=$pane"
      qp="$(printf '%q' "$pane")"
      run_after_popup_closes "tmux switch-client -t $qp
 tmux select-pane -t $qp
 cmd=\"\$(tmux display-message -p -t $qp '#{pane_current_command}' | tr '[:upper:]' '[:lower:]')\"
 if [[ \"\$cmd\" == \"nvim\" ]]; then
   tmux send-keys -t $qp Escape
   tmux send-keys -t $qp Space g g
 else
   tmux send-keys -t $qp C-c
   tmux send-keys -t $qp lazygit C-m
 fi"
    else
      log "pane not found for lazygit target=$target"
      tmux display-message "open-session-manager: pane not found for lazygit"
    fi
    ;;
  *)
    ;;
esac
