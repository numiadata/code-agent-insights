import { z } from 'zod';

// 1. SessionStatus
export const SessionStatusSchema = z.enum(['completed', 'abandoned', 'error', 'in_progress']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// 2. SessionSource
export const SessionSourceSchema = z.enum(['claude_code', 'cursor', 'vscode']);
export type SessionSource = z.infer<typeof SessionSourceSchema>;

// Outcome enum (used in Session and SubAgentInvocation)
export const OutcomeSchema = z.enum(['success', 'partial', 'failure', 'unknown']);
export type Outcome = z.infer<typeof OutcomeSchema>;

// 3. Session
export const SessionSchema = z.object({
  id: z.string().uuid(),
  source: SessionSourceSchema,
  projectPath: z.string(),
  projectName: z.string(),
  gitBranch: z.string().optional(),
  gitUser: z.string().optional(),
  startedAt: z.date(),
  endedAt: z.date().optional(),
  status: SessionStatusSchema,
  tokenCount: z.number().default(0),
  turnCount: z.number().default(0),
  toolCallCount: z.number().default(0),
  errorCount: z.number().default(0),
  filesModified: z.number().default(0),
  rawPath: z.string(),
  summary: z.string().optional(),
  outcome: OutcomeSchema.default('unknown'),
  skillInvocationCount: z.number().default(0),
  subAgentCount: z.number().default(0),
  usedPlanMode: z.boolean().default(false),
  usedThinking: z.boolean().default(false),
  usedSubAgents: z.boolean().default(false),
  primaryTools: z.array(z.string()).default([]),
});
export type Session = z.infer<typeof SessionSchema>;

// 4. EventType
export const EventTypeSchema = z.enum([
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_result',
  'error',
  'file_read',
  'file_write',
  'file_create',
  'command_execute',
  'thinking',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

// 5. Event
export const EventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: EventTypeSchema,
  timestamp: z.date(),
  sequenceNumber: z.number(),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Event = z.infer<typeof EventSchema>;

// 6. ToolCall
export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventId: z.string().uuid(),
  toolName: z.string(),
  parameters: z.record(z.unknown()),
  result: z.string().optional(),
  success: z.boolean(),
  durationMs: z.number().optional(),
  timestamp: z.date(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// 7. ErrorRecord
export const ErrorRecordSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventId: z.string().uuid(),
  errorType: z.string(),
  errorMessage: z.string(),
  stackTrace: z.string().optional(),
  filePath: z.string().optional(),
  lineNumber: z.number().optional(),
  resolved: z.boolean().default(false),
  resolutionEventId: z.string().uuid().optional(),
  timestamp: z.date(),
});
export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;

// 8. LearningType
export const LearningTypeSchema = z.enum([
  'pattern',
  'antipattern',
  'convention',
  'fix',
  'preference',
  'context',
]);
export type LearningType = z.infer<typeof LearningTypeSchema>;

// 9. LearningScope
export const LearningScopeSchema = z.enum(['global', 'project', 'file', 'language']);
export type LearningScope = z.infer<typeof LearningScopeSchema>;

// 10. LearningSource
export const LearningSourceSchema = z.enum(['extracted', 'explicit']);
export type LearningSource = z.infer<typeof LearningSourceSchema>;

// 11. Learning
export const LearningSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  projectPath: z.string().optional(),
  content: z.string(),
  type: LearningTypeSchema,
  scope: LearningScopeSchema.default('project'),
  confidence: z.number().min(0).max(1).default(1),
  tags: z.array(z.string()).default([]),
  relatedFiles: z.array(z.string()).default([]),
  relatedErrors: z.array(z.string()).default([]),
  source: LearningSourceSchema,
  appliedCount: z.number().default(0),
  lastAppliedAt: z.date().optional(),
  createdAt: z.date(),
});
export type Learning = z.infer<typeof LearningSchema>;

// 12. SkillCategory
export const SkillCategorySchema = z.enum(['public', 'user', 'example']);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

// 13. SkillInvocation
export const SkillInvocationSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  skillPath: z.string(),
  skillName: z.string(),
  skillCategory: SkillCategorySchema,
  invokedAt: z.date(),
  sequenceNumber: z.number(),
  contextBefore: z.string().optional(),
});
export type SkillInvocation = z.infer<typeof SkillInvocationSchema>;

// 14. SubAgentInvocation
export const SubAgentInvocationSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  parentEventId: z.string().uuid().nullable(),
  taskDescription: z.string(),
  toolsAllowed: z.array(z.string()).default([]),
  startedAt: z.date(),
  endedAt: z.date().optional(),
  tokenCount: z.number().default(0),
  turnCount: z.number().default(0),
  outcome: OutcomeSchema.default('unknown'),
  resultSummary: z.string().optional(),
});
export type SubAgentInvocation = z.infer<typeof SubAgentInvocationSchema>;

// 15. ToolSequence
export const ToolSequenceSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  tools: z.array(z.string()),
  startedAt: z.date(),
  endedAt: z.date(),
  success: z.boolean(),
  taskType: z.string().optional(),
});
export type ToolSequence = z.infer<typeof ToolSequenceSchema>;

// 16. SessionModes
export const SessionModesSchema = z.object({
  sessionId: z.string().uuid(),
  usedPlanMode: z.boolean().default(false),
  planModeCount: z.number().default(0),
  usedThinking: z.boolean().default(false),
  thinkingBlockCount: z.number().default(0),
  usedCompact: z.boolean().default(false),
  usedSubAgents: z.boolean().default(false),
  subAgentCount: z.number().default(0),
  skillsUsed: z.array(z.string()).default([]),
});
export type SessionModes = z.infer<typeof SessionModesSchema>;

// 17. SessionSummary
export const SessionSummarySchema = z.object({
  sessionId: z.string().uuid(),
  summary: z.string(),
  workDone: z.array(z.string()).default([]),
  filesChanged: z.array(z.string()).default([]),
  errorsEncountered: z.array(z.string()).default([]),
  errorsResolved: z.array(z.string()).default([]),
  keyDecisions: z.array(z.string()).default([]),
  generatedAt: z.coerce.date(),
  modelUsed: z.string().optional()
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
