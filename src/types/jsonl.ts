export interface JsonlMessage {
  id: string;
  timestamp: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  content?: any;
  isSidechain?: boolean; // True if this message is part of a sub-agent execution
}

export interface TranscriptMessage {
  type?: string;
  usage?: JsonlMessage['usage'];
  message?: {
    usage?: JsonlMessage['usage'];
    id?: string;
  };
  id?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
}

export interface JsonlFileInfo {
  sessionId: string;
  projectDir: string;
  filePath: string;
  lastModified: Date;
}