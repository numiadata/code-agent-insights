-- ===================================================================
-- Code Agent Insights - Mode Effectiveness Analysis Queries
-- ===================================================================
-- Usage: sqlite3 -header -column ~/.code-agent-insights/insights.db < analysis-queries.sql
-- Or run individual queries as needed

-- QUICK STATS
-- ===================================================================

-- 1. Mode Usage Overview
SELECT
  'Plan Mode' as mode,
  SUM(CASE WHEN used_plan_mode = 1 THEN 1 ELSE 0 END) as used,
  COUNT(*) as total,
  ROUND(SUM(CASE WHEN used_plan_mode = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) || '%' as usage_rate
FROM sessions
UNION ALL
SELECT
  'Thinking Mode',
  SUM(CASE WHEN sm.used_thinking = 1 THEN 1 ELSE 0 END),
  COUNT(*),
  ROUND(SUM(CASE WHEN sm.used_thinking = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) || '%'
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id
UNION ALL
SELECT
  'Sub-Agents',
  SUM(CASE WHEN sm.used_sub_agents = 1 THEN 1 ELSE 0 END),
  COUNT(*),
  ROUND(SUM(CASE WHEN sm.used_sub_agents = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) || '%'
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id;

-- 2. Success Rates by Mode
.print ""
.print "PLAN MODE EFFECTIVENESS:"
SELECT
  CASE WHEN used_plan_mode = 1 THEN 'WITH plan mode' ELSE 'WITHOUT plan mode' END as status,
  COUNT(*) as sessions,
  ROUND(AVG(CASE WHEN outcome = 'success' THEN 100.0 ELSE 0.0 END), 1) || '%' as success_rate,
  ROUND(AVG(error_count), 1) as avg_errors,
  ROUND(AVG(token_count), 0) as avg_tokens
FROM sessions
GROUP BY used_plan_mode
ORDER BY used_plan_mode DESC;

.print ""
.print "THINKING MODE EFFECTIVENESS:"
SELECT
  CASE WHEN sm.used_thinking = 1 THEN 'WITH thinking' ELSE 'WITHOUT thinking' END as status,
  COUNT(*) as sessions,
  ROUND(AVG(CASE WHEN s.outcome = 'success' THEN 100.0 ELSE 0.0 END), 1) || '%' as success_rate,
  ROUND(AVG(s.error_count), 1) as avg_errors,
  ROUND(AVG(sm.thinking_block_count), 0) as avg_thinking_blocks
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id
GROUP BY sm.used_thinking
ORDER BY sm.used_thinking DESC;

-- DETAILED QUERIES
-- ===================================================================

-- 3. Sessions Using Plan Mode (Detailed)
.print ""
.print "SESSIONS WITH PLAN MODE:"
SELECT
  substr(s.id, 1, 8) as id,
  s.project_name,
  datetime(s.started_at, 'unixepoch') as date,
  s.outcome,
  s.turn_count as turns,
  s.error_count as errors,
  sm.plan_mode_count as plan_invocations
FROM sessions s
JOIN session_modes sm ON s.id = sm.session_id
WHERE sm.used_plan_mode = 1
ORDER BY s.started_at DESC;

-- 4. Top Thinking Sessions
.print ""
.print "TOP 10 THINKING SESSIONS:"
SELECT
  substr(s.id, 1, 8) as id,
  s.project_name,
  s.outcome,
  s.error_count as errors,
  sm.thinking_block_count as thinking_blocks
FROM sessions s
JOIN session_modes sm ON s.id = sm.session_id
WHERE sm.used_thinking = 1
ORDER BY sm.thinking_block_count DESC
LIMIT 10;

-- 5. Mode Combinations Analysis
.print ""
.print "MODE COMBINATIONS:"
.print "(P=Plan, T=Thinking, S=Sub-Agents)"
SELECT
  CASE WHEN sm.used_plan_mode = 1 THEN 'P' ELSE '-' END ||
  CASE WHEN sm.used_thinking = 1 THEN 'T' ELSE '-' END ||
  CASE WHEN sm.used_sub_agents = 1 THEN 'S' ELSE '-' END as modes,
  COUNT(*) as sessions,
  ROUND(AVG(CASE WHEN s.outcome = 'success' THEN 100.0 ELSE 0.0 END), 1) || '%' as success_rate,
  ROUND(AVG(s.error_count), 1) as avg_errors,
  ROUND(AVG(s.token_count), 0) as avg_tokens
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id
GROUP BY modes
ORDER BY sessions DESC;

-- CUSTOM QUERIES
-- ===================================================================

-- 6. Error Correlation with Thinking
.print ""
.print "DO COMPLEX SESSIONS USE THINKING MORE?"
SELECT
  CASE
    WHEN error_count = 0 THEN '0 errors'
    WHEN error_count BETWEEN 1 AND 5 THEN '1-5 errors'
    WHEN error_count BETWEEN 6 AND 10 THEN '6-10 errors'
    ELSE '10+ errors'
  END as error_range,
  COUNT(*) as sessions,
  SUM(CASE WHEN sm.used_thinking = 1 THEN 1 ELSE 0 END) as with_thinking,
  ROUND(SUM(CASE WHEN sm.used_thinking = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) || '%' as thinking_rate
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id
GROUP BY error_range
ORDER BY MIN(s.error_count);

-- 7. Project-Level Mode Usage
.print ""
.print "MODE USAGE BY PROJECT:"
SELECT
  s.project_name,
  COUNT(*) as sessions,
  SUM(CASE WHEN s.used_plan_mode = 1 THEN 1 ELSE 0 END) as plan_mode,
  SUM(CASE WHEN sm.used_thinking = 1 THEN 1 ELSE 0 END) as thinking,
  ROUND(AVG(CASE WHEN s.outcome = 'success' THEN 100.0 ELSE 0.0 END), 1) || '%' as success_rate
FROM sessions s
LEFT JOIN session_modes sm ON s.id = sm.session_id
GROUP BY s.project_name
ORDER BY sessions DESC
LIMIT 10;
