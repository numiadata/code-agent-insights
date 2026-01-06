import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session,
  Event,
  ToolCall,
  ErrorRecord,
  SkillInvocation,
  SubAgentInvocation,
  ToolSequence,
  SessionModes,
  SkillCategory,
} from '../../types';

// Internal interfaces for raw message parsing
interface RawMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  timestamp?: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string;
  thinking?: string;
}

interface ParsedSession {
  session: Session;
  events: Event[];
  toolCalls: ToolCall[];
  errors: ErrorRecord[];
  skillInvocations: SkillInvocation[];
  subAgentInvocations: SubAgentInvocation[];
  toolSequences: ToolSequence[];
  sessionModes: SessionModes;
  stats: {
    totalLines: number;
    parsedLines: number;
    skippedLines: number;
    warnings: string[];
  };
}

interface ProjectInfo {
  path?: string;
  name?: string;
  gitBranch?: string;
  gitUser?: string;
}

export class ClaudeCodeParser {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir || path.join(process.env.HOME || '', '.claude');
  }

  async discoverSessions(): Promise<string[]> {
    // Claude Code stores sessions in two possible locations:
    // 1. Directly in project dirs: ~/.claude/projects/*/*.jsonl
    // 2. In sessions subdirs: ~/.claude/projects/*/sessions/*.json (for tests)
    const patterns = [
      path.join(this.claudeDir, 'projects/*/*.jsonl'),
      path.join(this.claudeDir, 'projects/*/sessions/*.json'),
    ];

    const allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await glob(pattern);
      allFiles.push(...files);
    }

    return allFiles;
  }

  async parseSession(sessionPath: string): Promise<ParsedSession> {
    // Initialize parse stats
    const stats = {
      totalLines: 0,
      parsedLines: 0,
      skippedLines: 0,
      warnings: [] as string[],
    };

    // 1. Read file with error handling
    let fileContent: string;
    try {
      fileContent = await fs.readFile(sessionPath, 'utf-8');
    } catch (error) {
      stats.warnings.push(`Failed to read file: ${(error as Error).message}`);
      throw new Error(`Failed to read session file at ${sessionPath}: ${(error as Error).message}`);
    }

    // 2. Detect format: JSONL (newline-delimited) vs regular JSON
    let messages: any[] = [];
    let sessionMetadata: any = null;

    const lines = fileContent.trim().split('\n').filter(line => line.trim().length > 0);
    stats.totalLines = lines.length;

    // Try parsing as JSONL first (Claude Code's actual format)
    let isJSONL = false;
    if (lines.length > 1) {
      // Check if file is JSONL by trying to parse first few lines
      try {
        // Try parsing the first line as JSON
        const firstLine = JSON.parse(lines[0].trim());
        // Try parsing second line to confirm it's JSONL
        const secondLine = JSON.parse(lines[1].trim());

        // Check if these look like Claude Code session events
        // Claude Code events have 'type' field and various other fields
        if (
          (firstLine.type || firstLine.message) &&
          (secondLine.type || secondLine.message)
        ) {
          // This is JSONL format - parse all lines with robust error handling
          const parsedEvents: any[] = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines
            if (!line) {
              stats.skippedLines++;
              continue;
            }

            try {
              const event = JSON.parse(line);
              parsedEvents.push(event);
              stats.parsedLines++;
            } catch (error) {
              stats.skippedLines++;
              stats.warnings.push(`Line ${i + 1}: Failed to parse JSON - ${(error as Error).message}`);
              // Continue processing remaining lines
            }
          }

          // Convert events to messages and extract metadata
          const result = this.convertClaudeCodeEventsToMessages(parsedEvents, stats);
          messages = result.messages;
          sessionMetadata = result.metadata;
          isJSONL = true;
        }
      } catch (err) {
        // Not JSONL, will try regular JSON below
        stats.warnings.push(`JSONL detection failed: ${(err as Error).message}`);
      }
    }

    // If not JSONL, try parsing as regular JSON
    if (!isJSONL) {
      try {
        const rawData = JSON.parse(fileContent);
        messages = Array.isArray(rawData) ? rawData : rawData.messages || [];
        stats.parsedLines = 1; // Counted as single JSON parse
      } catch (err) {
        stats.warnings.push(`JSON parsing failed: ${(err as Error).message}`);
        throw new Error(
          `Failed to parse session file as either JSONL or JSON: ${(err as Error).message}`
        );
      }
    }

    // 3. Initialize arrays
    const events: Event[] = [];
    const toolCalls: ToolCall[] = [];
    const errors: ErrorRecord[] = [];
    const skillInvocations: SkillInvocation[] = [];
    const subAgentInvocations: SubAgentInvocation[] = [];

    // 4. Initialize sequenceNumber
    let sequenceNumber = 0;

    // Track tool call IDs for result matching
    const toolCallMap = new Map<string, { toolCall: ToolCall; event: Event }>();

    // For session metadata
    const sessionId = uuidv4();
    let firstTimestamp: Date | undefined;
    let lastTimestamp: Date | undefined;

    // 5. Process each message
    for (const message of messages) {
      // Handle null/undefined messages
      if (!message || typeof message !== 'object') {
        stats.warnings.push('Skipping invalid message (not an object)');
        continue;
      }

      // Handle missing timestamp
      const timestamp = message.timestamp ? new Date(message.timestamp) : new Date();

      if (!firstTimestamp) {
        firstTimestamp = timestamp;
      }
      lastTimestamp = timestamp;

      // Handle missing role
      const role = message.role || 'assistant';

      // If content is string: create user_message or assistant_message event
      if (typeof message.content === 'string') {
        const event: Event = {
          id: uuidv4(),
          sessionId,
          type: role === 'user' ? 'user_message' : 'assistant_message',
          timestamp,
          sequenceNumber: sequenceNumber++,
          content: message.content,
        };
        events.push(event);
      } else if (Array.isArray(message.content)) {
        // If content is array of ContentBlocks, parse each block
        for (const block of message.content) {
          // Handle null/undefined blocks
          if (!block || typeof block !== 'object') {
            stats.warnings.push('Skipping invalid content block (not an object)');
            continue;
          }

          // Handle missing block type
          if (!block.type) {
            stats.warnings.push('Skipping content block without type');
            continue;
          }

          if (block.type === 'text' && block.text) {
            // Create assistant_message event with the text
            const event: Event = {
              id: uuidv4(),
              sessionId,
              type: 'assistant_message',
              timestamp,
              sequenceNumber: sequenceNumber++,
              content: block.text,
            };
            events.push(event);
          } else if (block.type === 'thinking' && block.thinking) {
            // Create thinking event with the thinking content
            const event: Event = {
              id: uuidv4(),
              sessionId,
              type: 'thinking',
              timestamp,
              sequenceNumber: sequenceNumber++,
              content: block.thinking,
            };
            events.push(event);
          } else if (block.type === 'tool_use') {
            // Validate tool name exists
            if (!block.name) {
              stats.warnings.push('Skipping tool_use block without name');
              continue;
            }

            // Create tool_call event
            const eventId = uuidv4();
            const toolCallId = block.id || uuidv4();
            const toolName = block.name;
            const parameters = block.input || {};

            const event: Event = {
              id: eventId,
              sessionId,
              type: 'tool_call',
              timestamp,
              sequenceNumber: sequenceNumber++,
              content: toolName,
              metadata: { toolName, parameters },
            };
            events.push(event);

            // Create ToolCall record
            const toolCall: ToolCall = {
              id: uuidv4(),
              sessionId,
              eventId,
              toolName,
              parameters,
              success: true, // Will be updated if error found in result
              timestamp,
            };
            toolCalls.push(toolCall);

            // Store for result matching
            toolCallMap.set(toolCallId, { toolCall, event });

            // Check if it's a skill invocation
            if (
              toolName === 'view' &&
              typeof parameters.path === 'string' &&
              parameters.path.startsWith('/mnt/skills/')
            ) {
              const skillPath = parameters.path;
              const skillName = this.extractSkillName(skillPath);
              const skillCategory = this.determineSkillCategory(skillPath);

              const skillInvocation: SkillInvocation = {
                id: uuidv4(),
                sessionId,
                skillPath,
                skillName,
                skillCategory,
                invokedAt: timestamp,
                sequenceNumber: sequenceNumber - 1,
              };
              skillInvocations.push(skillInvocation);
            }

            // Check if it's a sub-agent
            if (toolName === 'task' || toolName === 'dispatch_agent') {
              const taskDescription =
                (parameters.description as string) ||
                (parameters.prompt as string) ||
                '';
              const toolsAllowed = (parameters.allowed_tools as string[]) || [];

              const subAgentInvocation: SubAgentInvocation = {
                id: uuidv4(),
                sessionId,
                parentEventId: eventId,
                taskDescription,
                toolsAllowed,
                startedAt: timestamp,
                tokenCount: 0,
                turnCount: 0,
                outcome: 'unknown',
              };
              subAgentInvocations.push(subAgentInvocation);
            }

            // Check if it's a file operation
            if (toolName === 'view' && parameters.path) {
              const fileEvent: Event = {
                id: uuidv4(),
                sessionId,
                type: 'file_read',
                timestamp,
                sequenceNumber: sequenceNumber++,
                content: parameters.path as string,
                metadata: parameters,
              };
              events.push(fileEvent);
            } else if (toolName === 'str_replace' && parameters.path) {
              const fileEvent: Event = {
                id: uuidv4(),
                sessionId,
                type: 'file_write',
                timestamp,
                sequenceNumber: sequenceNumber++,
                content: parameters.path as string,
                metadata: parameters,
              };
              events.push(fileEvent);
            } else if (toolName === 'create_file' && parameters.path) {
              const fileEvent: Event = {
                id: uuidv4(),
                sessionId,
                type: 'file_create',
                timestamp,
                sequenceNumber: sequenceNumber++,
                content: parameters.path as string,
                metadata: parameters,
              };
              events.push(fileEvent);
            }

            // Check if it's a command
            if ((toolName === 'bash_tool' || toolName === 'bash') && parameters.command) {
              const commandEvent: Event = {
                id: uuidv4(),
                sessionId,
                type: 'command_execute',
                timestamp,
                sequenceNumber: sequenceNumber++,
                content: parameters.command as string,
                metadata: parameters,
              };
              events.push(commandEvent);
            }
          } else if (block.type === 'tool_result') {
            // Create tool_result event
            const resultContent =
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            const toolResultId = block.id;

            const event: Event = {
              id: uuidv4(),
              sessionId,
              type: 'tool_result',
              timestamp,
              sequenceNumber: sequenceNumber++,
              content: resultContent,
              metadata: { toolResultId },
            };
            events.push(event);

            // Update corresponding tool call with result
            if (toolResultId && toolCallMap.has(toolResultId)) {
              const { toolCall } = toolCallMap.get(toolResultId)!;
              toolCall.result = resultContent;
            }

            // Extract errors using regex patterns
            const errorPatterns = [
              { regex: /Error: (.+)/g, type: 'Error' },
              { regex: /TypeError: (.+)/g, type: 'TypeError' },
              { regex: /SyntaxError: (.+)/g, type: 'SyntaxError' },
              { regex: /ReferenceError: (.+)/g, type: 'ReferenceError' },
              { regex: /npm ERR! (.+)/g, type: 'npm' },
              { regex: /error\[E\d+\]: (.+)/g, type: 'Rust' },
              { regex: /FAILED (.+)/g, type: 'Test' },
              { regex: /Exception: (.+)/g, type: 'Exception' },
            ];

            for (const { regex, type } of errorPatterns) {
              let match;
              while ((match = regex.exec(resultContent)) !== null) {
                const errorRecord: ErrorRecord = {
                  id: uuidv4(),
                  sessionId,
                  eventId: event.id,
                  errorType: type,
                  errorMessage: match[1],
                  resolved: false,
                  timestamp,
                };
                errors.push(errorRecord);

                // Mark the tool call as failed
                if (toolResultId && toolCallMap.has(toolResultId)) {
                  const { toolCall } = toolCallMap.get(toolResultId)!;
                  toolCall.success = false;
                }
              }
            }
          }
        }
      }
    }

    // 6. Detect modes
    let planModeCount = 0;
    let usedCompact = false;
    for (const event of events) {
      if (event.type === 'user_message' && event.content) {
        if (event.content.toLowerCase().includes('/plan')) {
          planModeCount++;
        }
        if (event.content.toLowerCase().includes('/compact')) {
          usedCompact = true;
        }
      }
    }

    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    const thinkingBlockCount = thinkingEvents.length;
    const usedThinking = thinkingBlockCount > 0;
    const usedPlanMode = planModeCount > 0;

    // 7. Extract tool sequences
    const toolSequences = this.extractToolSequences(sessionId, toolCalls);

    // 8. Calculate session stats
    const tokenCount = this.estimateTokens(messages);
    const turnCount = events.filter((e) => e.type === 'user_message').length;
    const toolCallCount = toolCalls.length;
    const errorCount = errors.length;
    const filesModified = this.countFilesModified(toolCalls);
    const skillInvocationCount = skillInvocations.length;
    const subAgentCount = subAgentInvocations.length;
    const primaryTools = this.getTopTools(toolCalls, 3);

    // 9. Infer outcome
    const unresolvedErrors = errors.filter((e) => !e.resolved).length;
    const hasCommit = events.some(
      (e) =>
        e.type === 'command_execute' &&
        e.content &&
        e.content.toLowerCase().includes('git commit')
    );
    let outcome: 'success' | 'partial' | 'failure' | 'unknown' = 'unknown';
    if (hasCommit && unresolvedErrors === 0) {
      outcome = 'success';
    } else if (unresolvedErrors > 3) {
      outcome = 'failure';
    } else if (unresolvedErrors > 0) {
      outcome = 'partial';
    }

    // 10. Extract project info from path
    const projectHash = this.extractProjectHash(sessionPath);
    const projectInfo = await this.loadProjectInfo(projectHash);
    const projectPath = projectInfo.path || this.inferProjectPath(sessionPath);
    const projectName = projectInfo.name || path.basename(projectPath);

    // 11. Create Session object
    const session: Session = {
      id: sessionId,
      source: 'claude_code',
      projectPath,
      projectName,
      gitBranch: projectInfo.gitBranch,
      gitUser: projectInfo.gitUser,
      startedAt: firstTimestamp || new Date(),
      endedAt: lastTimestamp,
      status: 'completed', // Can be refined based on session analysis
      tokenCount,
      turnCount,
      toolCallCount,
      errorCount,
      filesModified,
      rawPath: sessionPath,
      outcome,
      skillInvocationCount,
      subAgentCount,
      usedPlanMode,
      usedThinking,
      usedSubAgents: subAgentCount > 0,
      primaryTools,
    };

    // 12. Create SessionModes object
    const skillsUsed = [...new Set(skillInvocations.map((s) => s.skillName))];
    const sessionModes: SessionModes = {
      sessionId,
      usedPlanMode,
      planModeCount,
      usedThinking,
      thinkingBlockCount,
      usedCompact,
      usedSubAgents: subAgentCount > 0,
      subAgentCount,
      skillsUsed,
    };

    // 13. Return ParsedSession with stats
    return {
      session,
      events,
      toolCalls,
      errors,
      skillInvocations,
      subAgentInvocations,
      toolSequences,
      sessionModes,
      stats,
    };
  }

  // Helper methods

  private extractSkillName(skillPath: string): string {
    // Extract skill name from path (last directory name before SKILL.md)
    const parts = skillPath.split('/');
    const skillMdIndex = parts.findIndex((p) => p === 'SKILL.md');
    if (skillMdIndex > 0) {
      return parts[skillMdIndex - 1];
    }
    return 'unknown';
  }

  private determineSkillCategory(skillPath: string): SkillCategory {
    if (skillPath.includes('/public/')) {
      return 'public';
    } else if (skillPath.includes('/user/')) {
      return 'user';
    }
    return 'example';
  }

  private extractToolSequences(sessionId: string, toolCalls: ToolCall[]): ToolSequence[] {
    const sequences: ToolSequence[] = [];
    const maxSequenceLength = 5;

    for (let i = 0; i < toolCalls.length; i++) {
      const sequenceTools: string[] = [];
      const sequenceStartTime = toolCalls[i].timestamp;
      let sequenceEndTime = toolCalls[i].timestamp;
      let allSuccess = toolCalls[i].success;

      for (let j = i; j < Math.min(i + maxSequenceLength, toolCalls.length); j++) {
        sequenceTools.push(toolCalls[j].toolName);
        sequenceEndTime = toolCalls[j].timestamp;
        allSuccess = allSuccess && toolCalls[j].success;
      }

      if (sequenceTools.length > 1) {
        const sequence: ToolSequence = {
          id: uuidv4(),
          sessionId,
          tools: sequenceTools,
          startedAt: sequenceStartTime,
          endedAt: sequenceEndTime,
          success: allSuccess,
        };
        sequences.push(sequence);
      }
    }

    return sequences;
  }

  private extractProjectHash(sessionPath: string): string {
    // Extract project hash from path structure: ~/.claude/projects/{hash}/sessions/*.json
    const parts = sessionPath.split('/');
    const projectsIndex = parts.indexOf('projects');
    if (projectsIndex >= 0 && projectsIndex + 1 < parts.length) {
      return parts[projectsIndex + 1];
    }
    return '';
  }

  private async loadProjectInfo(projectHash: string): Promise<ProjectInfo> {
    if (!projectHash) {
      return {};
    }

    const projectInfoPath = path.join(
      this.claudeDir,
      'projects',
      projectHash,
      '.project_info'
    );

    try {
      const content = await fs.readFile(projectInfoPath, 'utf-8');
      const info = JSON.parse(content);
      return {
        path: info.path,
        name: info.name,
        gitBranch: info.git_branch,
        gitUser: info.git_user,
      };
    } catch {
      return {};
    }
  }

  private inferProjectPath(sessionPath: string): string {
    // Fallback: try to extract from session path or use parent directory
    const projectHash = this.extractProjectHash(sessionPath);
    if (projectHash) {
      return path.join(this.claudeDir, 'projects', projectHash);
    }
    return path.dirname(path.dirname(sessionPath));
  }

  private estimateTokens(messages: RawMessage[]): number {
    // Estimate tokens as character count / 4
    let totalChars = 0;
    for (const message of messages) {
      if (typeof message.content === 'string') {
        totalChars += message.content.length;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.text) totalChars += block.text.length;
          if (block.thinking) totalChars += block.thinking.length;
          if (block.content) totalChars += block.content.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  private countFilesModified(toolCalls: ToolCall[]): number {
    const filePaths = new Set<string>();
    for (const toolCall of toolCalls) {
      if (
        (toolCall.toolName === 'str_replace' || toolCall.toolName === 'create_file') &&
        toolCall.parameters.path
      ) {
        filePaths.add(toolCall.parameters.path as string);
      }
    }
    return filePaths.size;
  }

  private getTopTools(toolCalls: ToolCall[], n: number): string[] {
    const toolCounts = new Map<string, number>();
    for (const toolCall of toolCalls) {
      toolCounts.set(toolCall.toolName, (toolCounts.get(toolCall.toolName) || 0) + 1);
    }

    return Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name]) => name);
  }

  /**
   * Convert Claude Code JSONL events to RawMessage array
   *
   * Claude Code stores sessions as JSONL where each line is an event like:
   * {"type":"user","message":{"role":"user","content":"..."},"timestamp":"...","uuid":"..."}
   * {"type":"assistant","message":{"role":"assistant","content":[...]},"timestamp":"...","uuid":"..."}
   * {"type":"summary","data":{...},"timestamp":"..."}
   * {"type":"file-history-snapshot",...}
   */
  private convertClaudeCodeEventsToMessages(
    events: any[],
    stats: { warnings: string[] }
  ): { messages: RawMessage[]; metadata: any } {
    const messages: RawMessage[] = [];
    let metadata: any = null;

    for (const event of events) {
      // Handle null/undefined events
      if (!event || typeof event !== 'object') {
        stats.warnings.push('Skipping invalid event (not an object)');
        continue;
      }

      const eventType = event.type;

      // Handle different event types
      if (eventType === 'summary') {
        // Extract session metadata from summary event
        if (event.data) {
          metadata = event.data;
        }
        continue;
      }

      if (eventType === 'file-history-snapshot') {
        // Skip file history snapshots
        continue;
      }

      if (eventType === 'user' || eventType === 'assistant') {
        // These should have a message object
        if (!event.message) {
          stats.warnings.push(`Skipping ${eventType} event without message object`);
          continue;
        }

        const msg = event.message;

        // Validate message has required fields
        if (!msg.role) {
          stats.warnings.push(`Skipping message without role`);
          continue;
        }

        // Handle missing content gracefully
        const content = msg.content ?? '';

        // Create RawMessage with timestamp from event
        const rawMessage: RawMessage = {
          role: msg.role,
          content: content,
          timestamp: event.timestamp || new Date().toISOString(),
        };

        messages.push(rawMessage);
        continue;
      }

      // Unknown event type - log warning but continue
      stats.warnings.push(`Unknown event type: ${eventType || 'undefined'}`);
    }

    return { messages, metadata };
  }
}
