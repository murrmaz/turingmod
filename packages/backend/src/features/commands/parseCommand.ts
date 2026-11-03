/** A `!command` as typed, split into the parts commands need. */
export interface ParsedCommand {
  /** The command name, lowercased and without the `!`: `!Lurk` runs `lurk`. */
  command: string;
  /** The words after the name, split on any run of whitespace. Never contains an empty string. */
  args: string[];
  /** Everything after the name, trimmed, with its inner spacing as typed. Empty if nothing. */
  argText: string;
}

const COMMAND = /^!(\S+)(.*)$/su;

/**
 * Parse a `!command`, or return null for anything else, including a bare `!` or `! word`. Chat and
 * the console's simulator both parse through this, so a command behaves the same in either.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = COMMAND.exec(text);
  if (!match) {
    return null;
  }
  const [, name = '', rest = ''] = match;
  const argText = rest.trim();
  return {
    command: name.toLowerCase(),
    args: argText === '' ? [] : argText.split(/\s+/),
    argText,
  };
}
