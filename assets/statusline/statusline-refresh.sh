#!/bin/sh
# Background refresh for Anthropic usage stats — called by statusline-command.sh
# This runs as a detached daemon process.
USAGE_CACHE="$HOME/.claude/statusline-usage-cache.json"

# Get OAuth token — cross-platform
token=""
if command -v security >/dev/null 2>&1; then
  # macOS: keychain
  token=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])" 2>/dev/null)
else
  # Linux: file-based credentials (after claude login)
  f="$HOME/.claude/.credentials.json"
  if [ -f "$f" ]; then
    token=$(python3 -c "import sys,json; print(json.load(open(sys.argv[1]))['claudeAiOauth']['accessToken'])" "$f" 2>/dev/null)
  fi
fi

[ -z "$token" ] && exit 1

result=$(curl -s --max-time 5 \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)

[ -z "$result" ] && exit 1
echo "$result" | jq -e ".error" > /dev/null 2>&1 && exit 1

tmp="${USAGE_CACHE}.tmp.$$"
echo "$result" | jq -c '{ts: now, five_hour_pct: (.five_hour.utilization // null), five_hour_reset: (.five_hour.resets_at // null), weekly_pct: (.seven_day.utilization // null), weekly_reset: (.seven_day.resets_at // null)}' > "$tmp" 2>/dev/null && mv -f "$tmp" "$USAGE_CACHE" 2>/dev/null
rm -f "$tmp" 2>/dev/null
