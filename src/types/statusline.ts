export interface TokenStatus {
  total: number;
  limit: number;
  percentage: number;
  remaining: number;
  remainingPercent: number;
  status: 'normal' | 'warning' | 'danger';
  emoji: string;
}

export interface FormatOptions {
  showPercentage?: boolean;
  showWarning?: boolean;
  showRemaining?: boolean;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_tokens?: number;
}

export interface TokenResult {
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  percentage: number;
}