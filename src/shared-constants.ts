/**
 * Shared constants between install and uninstall scripts
 * NEVER duplicate these strings - always import from here
 */

// The exact command pattern we add to statuslines
export const TOKEN_NERD_COMMAND_PATTERN = 'npx token-nerd --statusline';

// The variable name we use 
export const TOKEN_NERD_VAR = 'TOKEN_NERD_OUTPUT';

// The pipe pattern we add to echo statements
export const TOKEN_NERD_PIPE_PATTERN = ` | $${TOKEN_NERD_VAR}`;

// Detection patterns for existing integration
export const DETECTION_PATTERNS = {
  VARIABLE: TOKEN_NERD_VAR,
  COMMAND: TOKEN_NERD_COMMAND_PATTERN
};