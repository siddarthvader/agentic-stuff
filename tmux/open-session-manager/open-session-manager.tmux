#!/usr/bin/env bash

# tmux plugin entrypoint
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$CURRENT_DIR/run.sh"

# key + popup config
key="$(tmux show-option -gqv @agent_sessions_key)"
key="${key:-a}"
popup_h="$(tmux show-option -gqv @agent_sessions_popup_height)"
popup_h="${popup_h:-70%}"
popup_w="$(tmux show-option -gqv @agent_sessions_popup_width)"
popup_w="${popup_w:-70%}"

debug_log="$(tmux show-option -gqv @agent_sessions_debug_log)"
if [ -n "$debug_log" ]; then
  inner_cmd="OSM_DEBUG_LOG=$(printf '%q' "$debug_log") $(printf '%q' "$RUNNER")"
else
  inner_cmd="$(printf '%q' "$RUNNER")"
fi

tmux bind-key "$key" display-popup -E -w "$popup_w" -h "$popup_h" "bash -lc $(printf '%q' "$inner_cmd")"
