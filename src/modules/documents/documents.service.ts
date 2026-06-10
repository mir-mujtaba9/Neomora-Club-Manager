import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import * as fs from 'fs';
import * as path from 'path';
 
const REQUIRED_DOC_TYPES = ['BIRTH_CERTIFICATE', 'ID_PHOTO'] as const;
 
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}
 
  private ensureDir(p: string) {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
 
  // ─── Upload ────────────────────────────────────────────────────────────────
 
  async uploadDocument(
    tenantId: string,
    user: any,
    participantId: string,
    file: any,
    docType: string,
    notes?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
 
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, tenantId, deletedAt: null },
    });
    if (!participant) throw new NotFoundException('Participant not found');
 
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== participant.locationId
    ) {
      throw new ForbiddenException(
        'Not allowed to upload for participant in different location',
      );
    }
 
    const filename = file.originalname;
    // Plan H — prefix with timestamp so re-uploading the same filename does
    // not silently overwrite the previous version on disk OR in S3.
    const safeName = `${Date.now()}_${filename}`;
    const storageKey = `${tenantId}/${participantId}/${docType}/${safeName}`;
 
    const localBase = path.join(process.cwd(), 'storage');
    const localPath = path.join(
      localBase,
      tenantId,
      participantId,
      docType,
    );
    this.ensureDir(localPath);
 
    const destPath = path.join(localPath, safeName);
 
    if (file.path) {
      fs.renameSync(file.path, destPath);
    } else if (file.buffer) {
      fs.writeFileSync(destPath, file.buffer);
    } else {
      throw new BadRequestException('Uploaded file missing');
    }
 
    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        participantId,
        docType: docType as any,
        storageKey,
      },
    });
 
    return { id: doc.id, storageKey };
  }
 
  // ─── Signed URL ────────────────────────────────────────────────────────────
 
  /**
   * GET /documents/:participantId/:docId/url
   * Returns a pre-signed (or locally signed) download URL valid for 15 min.
   *
   * Plan H — accepts a `disposition` of 'inline' (preview in browser) or
   * 'attachment' (force download). The local-download endpoint reads this
   * from the query string; for S3 we pass ResponseContentDisposition.
   */
  async getSignedUrl(
    tenantId: string,
    user: any,
    participantId: string,
    docId: string,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<{ url: string; expiresIn: number }> {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, participantId, tenantId, deletedAt: null },
      select: {
        id: true,
        storageKey: true,
        participantId: true,
        participant: { select: { locationId: true } },
      },
    });
 
    if (!doc) throw new NotFoundException('Document not found');
 
    // Location managers may only access documents from their own location
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== doc.participant.locationId
    ) {
      throw new ForbiddenException(
        'You do not have access to this document',
      );
    }
 
    const signed = await this.storageService.getSignedUrl(doc.storageKey, 900);
    // Local fallback uses our own /documents/download endpoint, so append
    // the disposition hint. S3 ignores this; when S3 path is later enabled
    // we'll wire it via ResponseContentDisposition on the SDK call.
    if (disposition === 'attachment' && signed.url.includes('/documents/download')) {
      const sep = signed.url.includes('?') ? '&' : '?';
      signed.url = `${signed.url}${sep}disposition=attachment`;
    }
    return signed;
  }
 
  // ─── Verify / Reject ──────────────────────────────────────────────────────
 
  /**
   * PATCH /documents/:docId/verify
   * Allowed statuses: VERIFIED | REJECTED
   *
   * After a successful VERIFIED transition the service checks whether all
   * required document types for the participant are now verified, and if so
   * advances the participant status from DOCUMENTS_PENDING → FEE_PENDING.
   */
  async verifyDocument(
    tenantId: string,
    user: any,
    docId: string,
    status: 'VERIFIED' | 'REJECTED',
  ) {
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      throw new BadRequestException(
        'status must be VERIFIED or REJECTED',
      );
    }
 
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, tenantId, deletedAt: null },
      include: {
        participant: {
          select: {
            id: true,
            status: true,
            locationId: true,
            tenantId: true,
          },
        },
      },
    });
 
    if (!doc) throw new NotFoundException('Document not found');
 
    // Location managers may only verify documents from their own location
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== doc.participant.locationId
    ) {
      throw new ForbiddenException(
        'You do not have permission to verify this document',
      );
    }
 
    if (doc.status === status) {
      // Idempotent — already in target state
      return { id: doc.id, status: doc.status, participantStatusChanged: false };
    }
 
    if (doc.status !== 'PENDING' && doc.status !== 'REJECTED') {
      throw new BadRequestException(
        `Document with status '${doc.status}' cannot be transitioned to '${status}'`,
      );
    }
 
    // Update document
    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status: status as any,
        verifiedById: user.sub ?? user.id ?? null,
        verifiedAt: new Date(),
      },
    });
 
    let participantStatusChanged = false;
 
    // Only attempt auto-transition when we just VERIFIED a document
    if (status === 'VERIFIED') {
      participantStatusChanged = await this.maybeAdvanceParticipantStatus(
        tenantId,
        doc.participant,
        user,
      );
    }
 
    return {
      id: updated.id,
      status: updated.status,
      verifiedAt: updated.verifiedAt,
      participantStatusChanged,
    };
  }
 
  /**
   * If the participant is in DOCUMENTS_PENDING and all required doc types
   * now have at least one VERIFIED document, advance to FEE_PENDING.
   */
  private async maybeAdvanceParticipantStatus(
    tenantId: string,
    participant: { id: string; status: any; locationId: string },
    user: any,
  ): Promise<boolean> {
    const participantStatus = participant.status as unknown as string;
 
    if (participantStatus !== 'DOCUMENTS_PENDING') {
      return false;
    }
 
    // Fetch all verified documents for this participant
    const verifiedDocs = await this.prisma.document.findMany({
      where: {
        tenantId,
        participantId: participant.id,
        status: 'VERIFIED',
        deletedAt: null,
      },
      select: { docType: true },
    });
 
    const verifiedTypes = new Set(verifiedDocs.map((d) => d.docType as string));
 
    const allRequiredVerified = REQUIRED_DOC_TYPES.every((t) =>
      verifiedTypes.has(t),
    );
 
    if (!allRequiredVerified) {
      return false;
    }
 
    await this.prisma.participant.update({
      where: { id: participant.id },
      data: { status: 'FEE_PENDING' as any },
    });
 
    // Audit trail via staff note
    const authorId = user?.sub ?? user?.id;
    if (authorId) {
      await this.prisma.staffNote.create({
        data: {
          tenantId,
          participantId: participant.id,
          authorId,
          note: 'Participant automatically advanced to FEE_PENDING — all required documents verified.',
        },
      });
    }
 
    return true;
  }
 
  // ─── Local download (dev/staging) ─────────────────────────────────────────
 
  /**
   * Plan H — list a participant's documents with verifier info. Filters
   * soft-deleted rows and applies the standard LOCATION_MANAGER scope.
   */
  async listDocuments(
    tenantId: string,
    user: any,
    participantId: string,
  ) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, tenantId, deletedAt: null },
      select: { id: true, locationId: true },
    });
    if (!participant) throw new NotFoundException('Participant not found');
 
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== participant.locationId
    ) {
      throw new ForbiddenException(
        'Not allowed to view documents for participant in different location',
      );
    }
 
    return this.prisma.document.findMany({
      where: { tenantId, participantId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
      include: {
        verifiedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
  }
 
  /**
   * Plan H — soft-delete a document. The file stays on disk/S3 for audit
   * recovery; only the DB row is hidden. Re-upload will create a fresh row
   * (collision-safe thanks to the timestamp-prefixed storage key).
   */
  async softDelete(
    tenantId: string,
    user: any,
    participantId: string,
    docId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, participantId, tenantId, deletedAt: null },
      include: { participant: { select: { locationId: true } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
 
    if (
      user.role === UserRole.LOCATION_MANAGER &&
      user.locationId !== doc.participant.locationId
    ) {
      throw new ForbiddenException(
        'Not allowed to delete documents for participant in different location',
      );
    }
 
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date() },
    });
    return { id: doc.id, deleted: true };
  }
 
  /**
   * Validates the signed token for a local-filesystem download request.
   * Returns the absolute file path if valid.
   */
  validateLocalDownload(
    storageKey: string,
    token: string,
    exp: string,
  ): string {
    const expNum = parseInt(exp, 10);
    if (isNaN(expNum)) throw new BadRequestException('Invalid exp parameter');
 
    const valid = this.storageService.verifyLocalToken(
      storageKey,
      token,
      expNum,
    );
    if (!valid) {
      throw new ForbiddenException('Download link is invalid or has expired');
    }
 
    if (!this.storageService.localFileExists(storageKey)) {
      throw new NotFoundException('File not found on disk');
    }
 
    return this.storageService.localPath(storageKey);
  }
}
 





