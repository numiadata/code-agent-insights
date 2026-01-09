#!/bin/bash
# Debug script for cai hooks indexing

echo "================================"
echo "🔍 CAI Hook Debugging Report"
echo "================================"
echo ""

# 1. Check if hook is installed
echo "1. Hook Status:"
echo "---"
cai hooks status
echo ""

# 2. Check recent sessions
echo "2. Recent Session Files:"
echo "---"
echo "Sessions in ~/.claude/projects/ modified in last 2 hours:"
find ~/.claude/projects -name "*.jsonl" -type f -mmin -120 -ls 2>/dev/null | head -5
echo ""

# 3. Run index with verbose mode and capture output
echo "3. Index Command (verbose, last 1 hour):"
echo "---"
cai index --since 1h --verbose 2>&1
echo ""

# 4. Check database stats immediately after
echo "4. Current Database Stats:"
echo "---"
cai stats --json | jq -r '.overview | "Total Sessions: \(.totalSessions)\nTotal Tokens: \(.totalTokens)\nTotal Errors: \(.totalErrors)\nTotal Learnings: \(.totalLearnings)"'
echo ""

# 5. Show last 3 indexed sessions from database
echo "5. Last 3 Indexed Sessions (direct DB query):"
echo "---"
sqlite3 ~/.code-agent-insights/insights.db <<EOF
SELECT
  datetime(started_at) as started,
  source,
  project_name,
  token_count,
  status,
  outcome
FROM sessions
ORDER BY started_at DESC
LIMIT 3;
EOF
echo ""

# 6. Check if any sessions are from today
echo "6. Today's Sessions:"
echo "---"
TODAY=$(date +%Y-%m-%d)
sqlite3 ~/.code-agent-insights/insights.db <<EOF
SELECT COUNT(*) as count
FROM sessions
WHERE date(started_at) = '$TODAY';
EOF
echo ""

# 7. Show session timestamps vs file modification times
echo "7. Timestamp Comparison:"
echo "---"
echo "Latest session file mtime:"
find ~/.claude/projects -name "*.jsonl" -type f -mmin -120 -exec stat -f "%Sm %N" -t "%Y-%m-%d %H:%M:%S" {} \; 2>/dev/null | sort -r | head -1
echo ""
echo "Latest session in database:"
sqlite3 ~/.code-agent-insights/insights.db "SELECT datetime(started_at) FROM sessions ORDER BY started_at DESC LIMIT 1;" 2>/dev/null
echo ""

# 8. Check hook log
echo "8. Recent Hook Activity:"
echo "---"
if [ -f ~/.code-agent-insights/hooks.log ]; then
  tail -5 ~/.code-agent-insights/hooks.log
else
  echo "No hooks.log found"
fi
echo ""

# 9. Test manual indexing with different time windows
echo "9. Testing Different Time Windows:"
echo "---"
echo "Files modified in last 1 hour:"
find ~/.claude/projects -name "*.jsonl" -type f -mmin -60 | wc -l
echo "Files modified in last 6 hours:"
find ~/.claude/projects -name "*.jsonl" -type f -mmin -360 | wc -l
echo "Files modified in last 24 hours:"
find ~/.claude/projects -name "*.jsonl" -type f -mmin -1440 | wc -l
echo ""

# 10. Show detailed session info for most recent file
echo "10. Most Recent Session File Details:"
echo "---"
LATEST_FILE=$(find ~/.claude/projects -name "*.jsonl" -type f -mmin -120 2>/dev/null | head -1)
if [ -n "$LATEST_FILE" ]; then
  echo "File: $LATEST_FILE"
  echo "Modified: $(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$LATEST_FILE")"
  echo "Size: $(stat -f "%z bytes" "$LATEST_FILE")"
  echo "First line:"
  head -1 "$LATEST_FILE" | jq -r 'if .type then "Type: \(.type)" else "No type field" end' 2>/dev/null || echo "Not valid JSON"
  echo ""
  echo "Already indexed in DB?"
  sqlite3 ~/.code-agent-insights/insights.db "SELECT id, started_at, status FROM sessions WHERE raw_path = '$LATEST_FILE' LIMIT 1;"
else
  echo "No session files found in last 2 hours"
fi
echo ""

echo "================================"
echo "✅ Debug report complete"
echo "================================"
