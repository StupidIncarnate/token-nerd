export interface Session {
  id: string;
  project: string;
  tokens: number;
  lastModified: Date;
  isActive: boolean;
  path: string;
}