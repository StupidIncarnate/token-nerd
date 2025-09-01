import type { Operation } from './operation';

export interface Bundle {
  id: string;
  timestamp: number;
  operations: Operation[];
  totalTokens: number;
  // Sub-agent support
  isSubAgent?: boolean;     // True if this bundle represents a sub-agent
  subAgentType?: string;    // Type of sub-agent
  parentTaskId?: string;    // Tool use ID of the parent Task operation
  operationCount?: number;  // Number of operations in sub-agent
  duration?: number;        // Duration in milliseconds
}