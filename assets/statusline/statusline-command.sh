#!/bin/sh
# Claude Code status line — robbyrussell theme + Anthropic usage stats
export LC_NUMERIC=C

input=$(cat)

# Extract fields from JSON
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // empty')

# Current directory basename (like zsh %c)
worktree_name=$(echo "$input" | jq -r '.worktree.name // empty')
if [ -n "$worktree_name" ]; then
  project_dir=$(echo "$input" | jq -r '.workspace.project_dir // empty')
  if [ -n "$project_dir" ]; then
    dir=$(basename "$project_dir")
  else
    dir=$(basename "$cwd")
  fi
else
  dir=$(basename "$cwd")
fi

# Git branch + dirty indicator
git_branch=""
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
  if [ -n "$branch" ]; then
    dirty=$(git -C "$cwd" status --porcelain 2>/dev/null)
    if [ -n "$dirty" ]; then
      git_branch=" git:(\033[0;31m${branch}\033[0;34m) \033[0;33m✗\033[0m"
    else
      git_branch=" git:(\033[0;31m${branch}\033[0;34m)\033[0m"
    fi
    git_branch="\033[1;34m${git_branch}"
  fi
fi

# Context usage indicator
ctx=""
if [ -n "$used" ]; then
  used_int=$(printf "%.0f" "$used")
  if [ "$used_int" -ge 80 ]; then
    ctx=" \033[0;31m[ctx:${used_int}%]\033[0m"
  elif [ "$used_int" -ge 50 ]; then
    ctx=" \033[0;33m[ctx:${used_int}%]\033[0m"
  else
    ctx=" \033[0;32m[ctx:${used_int}%]\033[0m"
  fi
fi

# Token counts
tokens=""
if [ -n "$input_tokens" ] && [ -n "$output_tokens" ]; then
  fmt_tokens() {
    if [ "$1" -ge 1000000 ]; then
      printf "%.1fM" "$(echo "$1 / 1000000" | bc -l)"
    elif [ "$1" -ge 1000 ]; then
      printf "%.0fk" "$(echo "$1 / 1000" | bc -l)"
    else
      printf "%d" "$1"
    fi
  }
  in_fmt=$(fmt_tokens "$input_tokens")
  out_fmt=$(fmt_tokens "$output_tokens")
  tokens=" \033[0;36m[↓${in_fmt} ↑${out_fmt}]\033[0m"
fi

# Anthropic usage stats (5h + weekly) — cached, refreshes every 120s
USAGE_CACHE="$HOME/.claude/statusline-usage-cache.json"
CACHE_TTL=120
usage_str=""

# Check cache freshness
need_refresh=1
if [ -f "$USAGE_CACHE" ]; then
  cache_ts=$(jq -r '.ts // 0' "$USAGE_CACHE" 2>/dev/null)
  now_ts=$(date +%s)
  if [ -n "$cache_ts" ]; then
    cache_age=$((now_ts - ${cache_ts%.*}))
    [ "$cache_age" -lt "$CACHE_TTL" ] && need_refresh=0
  fi
fi

# Refresh in background — double-fork via python3 to fully daemonize
if [ "$need_refresh" -eq 1 ]; then
  REFRESH_SCRIPT="$HOME/.claude/statusline-refresh.sh"
  if [ -f "$REFRESH_SCRIPT" ]; then
    python3 -c "
import os, sys
if os.fork() != 0: sys.exit(0)
os.setsid()
if os.fork() != 0: sys.exit(0)
os.execvp('sh', ['sh', '$REFRESH_SCRIPT'])
" 2>/dev/null
  fi
fi

# Render from cache
if [ -f "$USAGE_CACHE" ]; then
  five_pct=$(jq -r '.five_hour_pct // empty' "$USAGE_CACHE" 2>/dev/null)
  five_reset=$(jq -r '.five_hour_reset // empty' "$USAGE_CACHE" 2>/dev/null)
  wk_pct=$(jq -r '.weekly_pct // empty' "$USAGE_CACHE" 2>/dev/null)
  wk_reset=$(jq -r '.weekly_reset // empty' "$USAGE_CACHE" 2>/dev/null)

  # Format time until reset
  fmt_reset() {
    [ -z "$1" ] && return
    reset_epoch=$(python3 -c "
from datetime import datetime, timezone
import sys
try:
    s = sys.argv[1]
    s = s.replace('+00:00', '+0000').replace('Z', '+0000')
    import re
    s = re.sub(r'\.\d+', '', s)
    dt = datetime.strptime(s, '%Y-%m-%dT%H:%M:%S%z')
    print(int(dt.timestamp()))
except:
    pass
" "$1" 2>/dev/null)
    [ -z "$reset_epoch" ] && return
    now_epoch=$(date +%s)
    diff=$((reset_epoch - now_epoch))
    [ "$diff" -le 0 ] && return
    days=$((diff / 86400))
    hours=$(( (diff % 86400) / 3600 ))
    mins=$(( (diff % 3600) / 60 ))
    if [ "$days" -gt 0 ]; then
      printf "%dd%dh" "$days" "$hours"
    else
      printf "%dh%dm" "$hours" "$mins"
    fi
  }

  # Color by percentage: green <70, yellow 70-89, red >=90
  pct_color() {
    pct_val=$(printf "%.0f" "$1" 2>/dev/null)
    [ -z "$pct_val" ] && return
    if [ "$pct_val" -ge 90 ]; then
      printf "\033[0;31m"
    elif [ "$pct_val" -ge 70 ]; then
      printf "\033[0;33m"
    else
      printf "\033[0;32m"
    fi
  }

  if [ -n "$five_pct" ]; then
    five_int=$(printf "%.0f" "$five_pct")
    five_c=$(pct_color "$five_pct")
    five_r=$(fmt_reset "$five_reset")
    if [ -n "$five_r" ]; then
      five_part="5h:${five_c}${five_int}%\033[0m\033[2m(${five_r})\033[0m"
    else
      five_part="5h:${five_c}${five_int}%\033[0m"
    fi

    usage_str=" ${five_part}"

    if [ -n "$wk_pct" ]; then
      wk_int=$(printf "%.0f" "$wk_pct")
      wk_c=$(pct_color "$wk_pct")
      wk_r=$(fmt_reset "$wk_reset")
      if [ -n "$wk_r" ]; then
        wk_part="\033[2mwk:\033[0m${wk_c}${wk_int}%\033[0m\033[2m(${wk_r})\033[0m"
      else
        wk_part="\033[2mwk:\033[0m${wk_c}${wk_int}%\033[0m"
      fi
      usage_str="${usage_str} ${wk_part}"
    fi
  fi
fi

# Model label
model_label=""
if [ -n "$model" ]; then
  model_label=" \033[0;35m${model}\033[0m"
fi

# Line 1: dir + git + model
# Line 2: ctx + tokens + usage
printf "\033[1;36m%s\033[0m%b%b\n%b%b%b\n" "$dir" "$git_branch" "$model_label" "$ctx" "$tokens" "$usage_str"
