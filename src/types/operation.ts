export interface Operation {
  tool: string;
  params: any;
  response: any;
  responseSize: number;
  timestamp: number;
  session_id: string;
  message_id?: string;
  sequence?: number;
  tool_use_id?: string;  // Links tool requests to responses
  contentPartIndex?: number; // For multi-part messages, which part this represents
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    total_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  tokens: number;  // Primary metric for display (context growth)
  generationCost: number;  // Output tokens (what was generated)
  contextGrowth: number;  // Cache creation tokens (new context added)
  ephemeral5m?: number;  // 5-minute cache tokens
  ephemeral1h?: number;  // 1-hour cache tokens
  cacheEfficiency?: number;  // Percentage of cache reuse
  timeGap?: number;  // Seconds since last message
  allocation: 'exact' | 'proportional' | 'estimated';
  details: string;
  // Sub-agent support
  isSidechain?: boolean;  // True if this is part of a sub-agent execution
  subAgentId?: string;    // Unique identifier for the sub-agent session
  subAgentType?: string;  // Type of sub-agent (e.g., 'general-purpose')
  parentTaskId?: string;  // Tool use ID of the parent Task operation
}