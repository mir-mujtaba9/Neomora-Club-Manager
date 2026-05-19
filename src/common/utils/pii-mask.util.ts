/**
 * Masks standard PII fields in an object with a specific placeholder
 */
export function maskPii(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(maskPii);
  }

  const masked = { ...data };
  const piiKeys = ['phone', 'email', 'dateOfBirth', 'date_of_birth'];

  for (const key in masked) {
    if (piiKeys.includes(key)) {
      masked[key] = '***MASKED***';
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskPii(masked[key]);
    }
  }

  return masked;
}
