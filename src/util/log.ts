/** Progress / status lines to stderr (keeps stdout free for JSON / machine output). */
export function logProgress(message: string): void {
  process.stderr.write(`acd: ${message}\n`);
}
