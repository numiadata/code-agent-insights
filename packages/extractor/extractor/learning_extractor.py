import anthropic
import json
from pydantic import BaseModel


class ExtractedLearning(BaseModel):
    content: str
    type: str
    scope: str
    confidence: float
    tags: list[str]
    related_files: list[str]


class ExtractionResult(BaseModel):
    learnings: list[ExtractedLearning]
    session_summary: str | None
    session_outcome: str


class LearningExtractor:
    SYSTEM_PROMPT = SYSTEM_PROMPT = """You extract HIGH-VALUE learnings from coding agent sessions. Be very selective.

ONLY extract learnings that meet ALL criteria:
1. SPECIFIC: Contains exact error messages, tool names, file patterns, or code snippets
2. ACTIONABLE: Someone could directly apply this to solve a future problem
3. NON-OBVIOUS: A senior developer wouldn't already know this
4. TRANSFERABLE: Useful beyond just this one session

DO NOT extract:
- Project descriptions or file paths (e.g., "Project is at /Users/...")
- Session metadata (token counts, model names, context usage)
- Generic best practices ("use version control", "monitor logs", "test your code")
- Descriptions of what the AI agent did ("Agent proactively offered...", "Claude searched for...")
- Workflow descriptions ("User uses warmup command...")
- Duplicate or near-duplicate insights

PREFER:
- Bug fixes with root cause AND solution
- Non-obvious tool/API behaviors discovered through debugging
- Project-specific conventions that differ from defaults
- Workarounds for framework/library quirks

Output valid JSON only:
{
  "learnings": [
    {
      "content": "Specific, actionable learning with concrete details",
      "type": "fix|pattern|antipattern|convention|preference",
      "scope": "global|project|language",
      "confidence": 0.0-1.0,
      "tags": ["specific", "keywords"],
      "related_files": []
    }
  ],
  "session_summary": "One sentence summary of task accomplished",
  "session_outcome": "success|partial|failure"
}

Aim for 2-5 high-quality learnings per session, not 10+ mediocre ones. It's better to extract nothing than to extract noise."""

    def __init__(self, api_key: str | None = None, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
    
    def extract(self, session_context: str, min_confidence: float = 0.7) -> dict:
        """Extract learnings from session context."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=self.SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract learnings:\n\n{session_context}"}]
        )
        
        text = response.content[0].text
        
        # Clean up potential markdown code blocks
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        
        try:
            result = json.loads(text.strip())
        except json.JSONDecodeError:
            result = {"learnings": [], "session_summary": None, "session_outcome": "unknown"}
        
        # Filter by confidence
        if "learnings" in result:
            result["learnings"] = [
                l for l in result["learnings"]
                if l.get("confidence", 0) >= min_confidence
            ]
        
        return result
    
    def build_session_context(
        self,
        events: list[dict],
        tool_calls: list[dict],
        errors: list[dict],
        skill_invocations: list[dict] = None,
        sub_agents: list[dict] = None,
        modes: dict = None,
        max_chars: int = 32000
    ) -> str:
        """Build context string from session data."""
        parts = []
        
        # Files touched
        files = set()
        for tc in tool_calls:
            params = tc.get("parameters", {})
            if isinstance(params, str):
                try:
                    params = json.loads(params)
                except:
                    params = {}
            if "path" in params:
                files.add(params["path"])
        
        if files:
            parts.append(f"Files touched: {', '.join(sorted(files)[:20])}")
        
        # Errors
        if errors:
            error_msgs = [e.get("error_message", "")[:200] for e in errors[:10]]
            parts.append("Errors:\n" + "\n".join(f"- {m}" for m in error_msgs))
        
        # Tool usage
        tool_counts = {}
        for tc in tool_calls:
            name = tc.get("tool_name", "unknown")
            tool_counts[name] = tool_counts.get(name, 0) + 1
        if tool_counts:
            parts.append(f"Tools: {', '.join(f'{k}({v})' for k, v in sorted(tool_counts.items(), key=lambda x: -x[1])[:10])}")
        
        # Skills used
        if skill_invocations:
            skills = [s.get("skill_name") for s in skill_invocations]
            parts.append(f"Skills used: {', '.join(set(skills))}")
        
        # Sub-agents
        if sub_agents:
            parts.append(f"Sub-agents spawned: {len(sub_agents)}")
            for sa in sub_agents[:3]:
                parts.append(f"  - Task: {sa.get('task_description', '')[:100]}")
        
        # Modes
        if modes:
            mode_info = []
            if modes.get("used_plan_mode"):
                mode_info.append("plan mode")
            if modes.get("used_thinking"):
                mode_info.append(f"thinking ({modes.get('thinking_block_count', 0)} blocks)")
            if mode_info:
                parts.append(f"Modes: {', '.join(mode_info)}")
        
        # Conversation (truncated)
        messages = []
        char_count = sum(len(p) for p in parts)
        char_limit = max_chars - char_count - 500
        
        for event in events:
            if event.get("type") in ("user_message", "assistant_message"):
                content = event.get("content", "")[:1000]
                role = "User" if event["type"] == "user_message" else "Claude"
                msg = f"[{role}]: {content}"
                
                if char_count + len(msg) > char_limit:
                    break
                
                messages.append(msg)
                char_count += len(msg)
        
        if messages:
            parts.append("Conversation:\n" + "\n".join(messages))
        
        return "\n\n".join(parts)
