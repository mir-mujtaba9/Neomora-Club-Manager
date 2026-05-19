import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Generates an HMAC SHA256 signature for a payload
 */
export function generateHmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies an HMAC signature using timing-safe comparison
 */
export function verifyHmac(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expectedSignature = generateHmac(secret, payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Specialized version for API keys (legacy compatibility or internal use)
 */
export function hashApiKey(key: string): string {
  const secret = process.env.API_KEY_SECRET || 'neomora-default-secret';
  return generateHmac(secret, key);
}
