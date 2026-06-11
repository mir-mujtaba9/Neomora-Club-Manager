import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

// pdfmake 0.3.x moved the PdfPrinter constructor out of the package
// root: `require('pdfmake')` now returns a small config object
// ({virtualfs, urlAccessPolicy, localAccessPolicy}), NOT the class.
// The constructor now lives at `pdfmake/js/Printer` and is exposed as
// the `default` export of that compiled CJS module. Older docs/snippets
// that show `require('pdfmake')` predate this restructure and will
// throw "PdfPrinter is not a constructor" at startup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = (require as any)('pdfmake/js/Printer').default;

/**
 * Plan F — generates a PDF receipt for a verified payment.
 *
 * `build(paymentId)` resolves the payment + linked context
 * (participant, guardian, session, invoice, tenant) and writes a
 * receipt to:
 *     storage/receipts/{tenantId}/{paymentId}.pdf
 *
 * Returns the storage key. The caller is responsible for setting
 * `payment.receiptKey` and notifying the guardian.
 *
 * Sync generation (no queue) is acceptable for MVP — receipts are
 * single-page documents that take 50–100 ms to render. If volume
 * grows, this method can be moved to a BullMQ processor with zero
 * call-site changes.
 *
 * Uses the system's built-in fonts directory; no font files are
 * shipped with this repo to keep the install footprint small. If you
 * see "font not found" at runtime, set `fonts.default.*` to point at
 * a TTF you've copied into the container.
 */
@Injectable()
export class ReceiptBuilderService {
  private readonly logger = new Logger(ReceiptBuilderService.name);

  // pdfmake requires fonts to be declared up-front. We use the default
  // PDF core 14 fonts (Helvetica family) which are always available
  // and don't need TTF files on disk.
  private readonly printer = new PdfPrinter({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async build(paymentId: string): Promise<{ storageKey: string }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        tenant: { select: { name: true } },
        enrolment: {
          include: {
            session: { select: { name: true, startDate: true, endDate: true } },
            participant: {
              select: { firstNameEn: true, lastNameEn: true, uniqueId: true },
            },
          },
        },
        invoice: { select: { invoiceNumber: true, dueDate: true } },
      },
    });
    if (!payment) throw new Error(`Payment ${paymentId} not found`);

    const tenantName = payment.tenant?.name ?? 'Tenant';
    const participantName = `${payment.enrolment.participant.firstNameEn} ${payment.enrolment.participant.lastNameEn}`;
    const uniqueId = payment.enrolment.participant.uniqueId;
    const sessionName = payment.enrolment.session?.name ?? '—';
    const invoiceNumber = payment.invoice?.invoiceNumber ?? '—';
    const paidAt = (payment.paidAt ?? new Date()).toISOString().slice(0, 10);

    const docDefinition: any = {
      defaultStyle: { font: 'Helvetica' },
      content: [
        { text: tenantName, style: 'header' },
        { text: 'Payment Receipt', style: 'subheader', margin: [0, 0, 0, 16] },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [{ text: 'Receipt No', bold: true }, payment.id.slice(0, 12)],
              [{ text: 'Date', bold: true }, paidAt],
              [{ text: 'Participant', bold: true }, `${participantName} (${uniqueId})`],
              [{ text: 'Session', bold: true }, sessionName],
              [{ text: 'Invoice', bold: true }, invoiceNumber],
              [
                { text: 'Amount', bold: true },
                `SAR ${payment.amount.toFixed(2)}`,
              ],
              [{ text: 'Method', bold: true }, payment.method],
              [{ text: 'Gateway', bold: true }, payment.gateway],
              [{ text: 'Status', bold: true }, payment.status],
            ],
          },
          layout: 'lightHorizontalLines',
        },
        {
          text: '\nThank you for your payment.',
          margin: [0, 24, 0, 0],
          italics: true,
        },
      ],
      styles: {
        header: { fontSize: 20, bold: true },
        subheader: { fontSize: 14, color: '#666' },
      },
      pageMargins: [40, 40, 40, 40],
    };

    const storageKey = path.posix.join(
      'receipts',
      payment.tenantId,
      `${payment.id}.pdf`,
    );
    const absPath = path.join(process.cwd(), 'storage', storageKey);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
      const stream = fs.createWriteStream(absPath);
      pdfDoc.pipe(stream);
      pdfDoc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    return { storageKey };
  }
}
