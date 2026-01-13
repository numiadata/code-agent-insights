---
name: code-agent-insights-workflow
description: Mandatory workflow and conventions for working on code-agent-insights project (project)
---

# Code Agent Insights Workflow

**Purpose**: Enforce best practices and prevent common mistakes when working on code-agent-insights.

**Scope**: This project only - mandatory workflow for AI agents and developers.

---

## ⚠️ CRITICAL: Before ANY Operation

### 1. Use Recall Tool FIRST (Mandatory)

Before debugging, investigating issues, or running commands:

```bash
# Check for past solutions
recall <issue-keywords>

# Example searches:
recall path normalization project_path    # Path issues
recall sync default no-global             # Sync conventions
recall indexing parser session            # Indexing bugs
recall database foreign key               # Database issues
```

**Why:** We've likely solved this before. Check past learnings to save 30+ minutes.

### 2. Check CLAUDE.md Conventions

Review the "Command Defaults & Conventions" section in CLAUDE.md:
- Command defaults (sync, index, clean)
- Flag behavior (--no-global, --force, --dry-run)
- Debugging protocol

### 3. Always Use Dry-Run First

For commands that modify data:

```bash
cai sync --dry-run          # Preview before syncing
cai clean --dry-run         # Preview before cleaning
cai index --force --verbose # Show what's happening
```

---

## Command Defaults & Critical Flags

### `cai sync`
- **Default behavior:** Project-only learnings (`--no-global`)
- **NEVER run without:** `--dry-run` first
- **Rare cases only:** `--global` (includes global learnings)

```bash
# ✓ CORRECT workflow
cai sync --dry-run    # 1. Preview
# Review output carefully
cai sync              # 2. Apply (project-only by default)

# ❌ WRONG workflow
cai sync              # Skipped preview!
cai sync --global     # Includes irrelevant global learnings!
```

### `cai index`
- **Default:** Incremental (new sessions only)
- **Use --force:** After parser fixes, path changes, schema updates
- **Use --verbose:** When debugging parse issues

```bash
cai index                    # Normal: index new sessions
cai index --force --verbose  # After fixes: reindex all
```

### `cai clean`
- **ALWAYS use --dry-run first:** Deletions are permanent

---

## Debugging Protocol (Mandatory Steps)

When a user reports an issue, follow this order:

### Step 1: Use Recall (5 seconds)
```bash
recall <error-keywords> <component-name>
```

Check if we've seen this before. Review past learnings.

### Step 2: Check CLAUDE.md (30 seconds)
- Read "Command Defaults & Conventions"
- Check "When to Use Recall" section
- Review recent learnings in the auto-generated section

### Step 3: Check Git History (1 minute)
```bash
git log --all --grep="<keyword>" --oneline
git show <commit-hash>
```

Look for recent fixes to the same component.

### Step 4: Investigate Code (only after above)
Now you can dive into the code with context from past solutions.

---

## Common Issues & Solutions

### Issue: "cai correlate not finding sessions"
**First action:** `recall path normalization project_path mismatch`
**Likely cause:** Path inference bug (dashes vs slashes)
**Solution documented in:** Past learnings about `inferProjectPath()`

### Issue: "Global learnings in project CLAUDE.md"
**First action:** `recall sync default no-global`
**Root cause:** Forgot to use default behavior
**Solution:** `cai sync` defaults to `--no-global` (project-only)

### Issue: "Sessions not indexed"
**First action:** `recall indexing discovery session jsonl`
**Check:** Session file locations, parser updates, path resolution
**Solution:** Often needs `cai index --force` after parser changes

---

## Saving New Learnings

When you discover something important:

```bash
# Use remember tool
remember --type pattern --scope project "Your learning here"

# Add relevant tags
--tags debugging,path-issues,sync,convention

# Then sync to CLAUDE.md (if appropriate)
cai sync --dry-run
cai sync
```

---

## What NOT to Do

### ❌ Don't Skip Recall
```bash
# User: "cai correlate not working"
# ❌ WRONG: grep -r "correlate" packages/
# ✓ CORRECT: recall correlate sessions path
```

### ❌ Don't Skip Dry-Run
```bash
# ❌ WRONG: cai sync
# ✓ CORRECT: cai sync --dry-run, review, then cai sync
```

### ❌ Don't Assume Defaults
```bash
# ❌ WRONG: Assume sync includes global
# ✓ CORRECT: Check CLAUDE.md conventions
```

### ❌ Don't Repeat Past Mistakes
```bash
# ❌ WRONG: Debug path issues from scratch
# ✓ CORRECT: recall path normalization (finds past solutions)
```

---

## Workflow Checklist

Before executing commands that modify data:

- [ ] Used `recall` tool with relevant keywords
- [ ] Checked CLAUDE.md "Command Defaults & Conventions"
- [ ] Ran command with `--dry-run` flag first
- [ ] Reviewed output carefully
- [ ] Verified scope (global vs project-specific)
- [ ] Ready to document new learnings if discovered

---

## Key Principles

1. **Memory First:** Check recall before debugging
2. **Preview First:** Use --dry-run before applying
3. **Context First:** Read CLAUDE.md conventions
4. **Document:** Save learnings for next time
5. **Project-Only:** Default to project-specific learnings

---

## Success Metrics

- ✓ Zero repeated debugging of solved issues
- ✓ Zero accidental global learning pollution
- ✓ Zero data loss from skipped dry-runs
- ✓ 100% workflow checklist compliance

**Remember:** This project is about building memory and learning from the past. Practice what we preach!
