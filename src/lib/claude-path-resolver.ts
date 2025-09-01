import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Interface for detected Claude paths and metadata
 */
interface ClaudePaths {
  projectsDir: string;
  settingsFile: string;
  configFile: string;
  version?: string;
  detectionMethod: 'validated' | 'fallback';
}

/**
 * Path candidates to try when detecting Claude installation
 */
interface PathCandidate {
  projectsDir: string;
  settingsFile: string;
  configFile: string;
  description: string;
}

/**
 * Cached detected paths - singleton pattern via module-level variable
 */
let detectedPaths: ClaudePaths | null = null;

/**
 * Get possible Claude installation paths to try
 * Orders them by likelihood (current first, then legacy/future)
 */
function getPathCandidates(): PathCandidate[] {
  const homedir = os.homedir();
  const isWindows = process.platform === 'win32';
  
  const candidates: PathCandidate[] = [];
  
  if (isWindows) {
    // Windows paths
    const appDataRoaming = path.join(homedir, 'AppData', 'Roaming');
    candidates.push({
      projectsDir: path.join(appDataRoaming, 'claude', 'projects'),
      settingsFile: path.join(appDataRoaming, 'claude', 'settings.json'),
      configFile: path.join(homedir, '.claude.json'),
      description: 'Windows AppData/Roaming'
    });
  } else {
    // Unix/Mac paths - current structure
    candidates.push({
      projectsDir: path.join(homedir, '.claude', 'projects'),
      settingsFile: path.join(homedir, '.claude', 'settings.json'),
      configFile: path.join(homedir, '.claude.json'),
      description: 'Current ~/.claude structure'
    });
    
    // Alternative config locations for future Claude versions
    candidates.push({
      projectsDir: path.join(homedir, '.config', 'claude', 'projects'),
      settingsFile: path.join(homedir, '.config', 'claude', 'settings.json'),
      configFile: path.join(homedir, '.config', 'claude', 'config.json'),
      description: 'XDG config directory'
    });
    
    // Potential future versioned directories
    candidates.push({
      projectsDir: path.join(homedir, '.claude', 'v2', 'projects'),
      settingsFile: path.join(homedir, '.claude', 'v2', 'settings.json'),
      configFile: path.join(homedir, '.claude.json'),
      description: 'Future versioned structure'
    });
  }
  
  return candidates;
}

/**
 * Validate that a set of paths appears to be a valid Claude installation
 */
function validateClaudePaths(candidate: PathCandidate): boolean {
  try {
    // Check if projects directory exists and contains subdirectories
    if (fs.existsSync(candidate.projectsDir)) {
      const entries = fs.readdirSync(candidate.projectsDir, { withFileTypes: true });
      const hasProjectDirs = entries.some(entry => entry.isDirectory());
      
      // Look for .jsonl files in project subdirectories
      if (hasProjectDirs) {
        for (const entry of entries.slice(0, 5)) { // Check up to 5 dirs for performance
          if (entry.isDirectory()) {
            const subDir = path.join(candidate.projectsDir, entry.name);
            try {
              const subFiles = fs.readdirSync(subDir);
              const hasJsonl = subFiles.some(f => f.endsWith('.jsonl'));
              if (hasJsonl) {
                return true; // Found JSONL files, this looks like Claude
              }
            } catch {
              continue; // Skip if can't read subdirectory
            }
          }
        }
      }
    }
    
    // Alternative validation: check for settings file
    if (fs.existsSync(candidate.settingsFile)) {
      try {
        const content = fs.readFileSync(candidate.settingsFile, 'utf-8');
        const parsed = JSON.parse(content);
        // Look for Claude-specific settings
        if (parsed.statusLine || parsed.hooks) {
          return true;
        }
      } catch {
        // Invalid JSON or read error, continue
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Get default/fallback paths when no valid Claude installation is detected
 */
function getDefaultPaths(): ClaudePaths {
  const homedir = os.homedir();
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    const appDataRoaming = path.join(homedir, 'AppData', 'Roaming');
    return {
      projectsDir: path.join(appDataRoaming, 'claude', 'projects'),
      settingsFile: path.join(appDataRoaming, 'claude', 'settings.json'),
      configFile: path.join(homedir, '.claude.json'),
      detectionMethod: 'fallback'
    };
  } else {
    return {
      projectsDir: path.join(homedir, '.claude', 'projects'),
      settingsFile: path.join(homedir, '.claude', 'settings.json'),
      configFile: path.join(homedir, '.claude.json'),
      detectionMethod: 'fallback'
    };
  }
}

/**
 * Attempt to detect Claude version from installation
 */
function detectVersion(paths: ClaudePaths): string | undefined {
  // Try to detect version from various sources
  try {
    // Check if settings file has version info
    if (fs.existsSync(paths.settingsFile)) {
      const content = fs.readFileSync(paths.settingsFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.version) {
        return parsed.version;
      }
    }
    
    // Check directory structure for version hints
    if (paths.projectsDir.includes('v2')) {
      return '2.x';
    }
    
    // Default assumption based on current structure
    return '1.x';
  } catch {
    return undefined;
  }
}

/**
 * Initialize/detect Claude paths (singleton pattern)
 */
function initializePaths(): ClaudePaths {
  if (detectedPaths) {
    return detectedPaths;
  }
  
  const candidates = getPathCandidates();
  
  // Try each candidate and use the first valid one
  for (const candidate of candidates) {
    if (validateClaudePaths(candidate)) {
      detectedPaths = {
        ...candidate,
        detectionMethod: 'validated' as const
      };
      detectedPaths.version = detectVersion(detectedPaths);
      return detectedPaths;
    }
  }
  
  // No valid installation found, use defaults
  detectedPaths = getDefaultPaths();
  detectedPaths.version = detectVersion(detectedPaths);
  return detectedPaths;
}

/**
 * Get the directory where Claude stores session JSONL files
 * Auto-detects Claude installation and adapts to different versions
 */
export function getClaudeProjectsDir(): string {
  return initializePaths().projectsDir;
}

/**
 * Get the Claude settings.json file path
 * Auto-detects Claude installation and adapts to different versions
 */
export function getClaudeSettingsFile(): string {
  return initializePaths().settingsFile;
}

/**
 * Get the Claude configuration file path (.claude.json)
 * Auto-detects Claude installation and adapts to different versions
 */
export function getClaudeConfigFile(): string {
  return initializePaths().configFile;
}

/**
 * Detect the Claude version if possible
 */
export function detectClaudeVersion(): string | undefined {
  return initializePaths().version;
}

/**
 * Get full path detection information for debugging
 */
export function getClaudePathInfo(): ClaudePaths {
  return initializePaths();
}

/**
 * Reset cached paths (useful for testing or if Claude installation changes)
 */
export function resetPathCache(): void {
  detectedPaths = null;
}