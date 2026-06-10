import QRCode from 'qrcode';

/**
 * Default render options for registration QR codes.
 * - errorCorrectionLevel 'M' = 15% recovery, good balance of size vs. resilience.
 * - margin 1 = minimum quiet zone (smaller PNG payload).
 * - width 512 = print-friendly resolution.
 *
 * If you ever switch from data URLs to file storage, this util is the only
 * place to change — callers just consume a string.
 */
const DEFAULT_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 512,
  type: 'image/png',
};

/**
 * Generates a QR-code PNG encoded as a `data:image/png;base64,...` URL.
 *
 * Returns a string suitable for direct storage in `Location.qrCodeUrl` and
 * direct use as an `<img src>` value.
 *
 * Throws if `text` is empty — callers must validate inputs first.
 */
export async function generateQrDataUrl(
  text: string,
  options?: Partial<QRCode.QRCodeToDataURLOptions>,
): Promise<string> {
  if (!text || !text.trim()) {
    throw new Error('generateQrDataUrl: text is required');
  }
  return QRCode.toDataURL(text, { ...DEFAULT_OPTIONS, ...options });
}

/**
 * Convenience: build the canonical registration URL for a location and
 * encode it as a QR data URL.
 */
export async function generateRegistrationQrDataUrl(
  webBaseUrl: string,
  registrationSlug: string,
): Promise<string> {
  const normalisedBase = webBaseUrl.replace(/\/+$/, '');
  const url = `${normalisedBase}/register/${registrationSlug}`;
  return generateQrDataUrl(url);
}
