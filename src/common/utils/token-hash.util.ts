import { createHash } from 'crypto';

export function hashTokenSha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
