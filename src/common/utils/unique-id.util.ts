/**
 * Generates a unique ID with a prefix and zero-padded sequence
 * Example: P-00123
 */
export function generateUniqueId(prefix: string, sequence: number): string {
  const paddedSequence = String(sequence).padStart(5, '0');
  return `${prefix}-${paddedSequence}`;
}
