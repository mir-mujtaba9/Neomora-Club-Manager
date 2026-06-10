import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { Response } from 'express';
import * as path from 'path';
 
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, Public } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { DocumentsService } from './documents.service.js';
import { DOCUMENT_TYPE } from '../../common/constants/document-type.constants.js';
 
function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
 
@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}
 
  // ─── Upload ──────────────────────────────────────────────────────────────
 
  @Post(':participantId')
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file: any, cb: any) => {
          const tmp = './uploads/tmp';
          try {
            fs.mkdirSync(tmp, { recursive: true });
          } catch (e) {}
          cb(null, tmp);
        },
        filename: (req: any, file: any, cb: any) => {
          const name = sanitizeFilename(file.originalname);
          cb(null, `${Date.now()}_${name}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async upload(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('participantId') participantId: string,
    @UploadedFile() file: any,
    @Body('docType') docType: string,
    @Body('notes') notes?: string,
  ) {
    if (!docType || !Object.values(DOCUMENT_TYPE).includes(docType as any)) {
      throw new BadRequestException('Invalid or missing docType');
    }
    return this.documentsService.uploadDocument(
      tenantId,
      user,
      participantId,
      file,
      docType,
      notes,
    );
  }
 
  // ─── GET signed/pre-signed download URL ──────────────────────────────────
 
  /**
   * GET /api/v1/documents/:participantId/:docId/url
   *
   * Returns a signed URL valid for 15 minutes.
   * When S3 is configured → real pre-signed S3 URL.
   * Otherwise              → a locally-signed URL served by the /download endpoint.
   *
   * Response:
   *   200 { url: string, expiresIn: 900 }
   */
  @Get(':participantId/:docId/url')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.LOCATION_MANAGER,
    UserRole.FINANCE_OFFICER,
    UserRole.STAFF,
  )
  async getSignedUrl(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('participantId') participantId: string,
    @Param('docId') docId: string,
    @Query('disposition') disposition?: string,
  ) {
    const d: 'inline' | 'attachment' =
      disposition === 'attachment' ? 'attachment' : 'inline';
    return this.documentsService.getSignedUrl(
      tenantId,
      user,
      participantId,
      docId,
      d,
    );
  }
 
  // ─── Plan H — list a participant's documents (F-21) ──────────────────
 
  /**
   * GET /api/v1/documents/by-participant/:participantId
   *
   * Returns all non-deleted documents for the participant, newest-first,
   * with verifier user info attached. Useful for the records UI without
   * forcing a full `GET /participants/:id`.
   *
   * The path uses `/by-participant/:id` instead of `/:id` to avoid
   * colliding with the public `/documents/download` route (Express matches
   * routes in definition order, and `download` would otherwise match
   * `:participantId='download'`).
   */
  @Get('by-participant/:participantId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.LOCATION_MANAGER,
    UserRole.FINANCE_OFFICER,
    UserRole.STAFF,
  )
  async listForParticipant(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('participantId') participantId: string,
  ) {
    return this.documentsService.listDocuments(tenantId, user, participantId);
  }
 
  // ─── Plan H — soft-delete a document (F-21) ─────────────────────────
 
  /**
   * DELETE /api/v1/documents/:participantId/:docId
   *
   * Soft-deletes the document. The file remains on disk/S3 for audit
   * recovery; only the DB row is hidden from listings.
   */
  @Delete(':participantId/:docId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async deleteDocument(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('participantId') participantId: string,
    @Param('docId') docId: string,
  ) {
    return this.documentsService.softDelete(tenantId, user, participantId, docId);
  }
 
  // ─── PATCH verify / reject ────────────────────────────────────────────────
 
  /**
   * PATCH /api/v1/documents/:docId/verify
   *
   * Body: { "status": "VERIFIED" | "REJECTED" }
   *
   * If all required documents are VERIFIED after this call,
   * the participant is automatically advanced from DOCUMENTS_PENDING → FEE_PENDING.
   *
   * Response:
   *   200 { id, status, verifiedAt, participantStatusChanged }
   */
  @Patch(':docId/verify')
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  async verifyDocument(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('docId') docId: string,
    @Body('status') status: string,
  ) {
    if (!status || !['VERIFIED', 'REJECTED'].includes(status)) {
      throw new BadRequestException(
        "Body must contain status: 'VERIFIED' or 'REJECTED'",
      );
    }
    return this.documentsService.verifyDocument(
      tenantId,
      user,
      docId,
      status as 'VERIFIED' | 'REJECTED',
    );
  }
 
  // ─── Local signed-URL download (dev / no-S3 fallback) ────────────────────
 
  /**
   * GET /api/v1/documents/download?key=<storageKey>&token=<hmac>&exp=<unix-ts>
   *
   * This endpoint is only meaningful when S3 is NOT configured.
   * It validates the HMAC token produced by StorageService.getLocalSignedUrl()
   * and streams the file from the local ./storage directory.
   *
   * The route is PUBLIC because the URL itself is the bearer credential
   * (HMAC-signed + expiry).  No JWT is required.
   */
  @Public()
  @Get('download')
  async localDownload(
    @Query('key') key: string,
    @Query('token') token: string,
    @Query('exp') exp: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    if (!key || !token || !exp) {
      throw new BadRequestException('Missing required query parameters');
    }
 
    const storageKey = decodeURIComponent(key);
    const filePath = this.documentsService.validateLocalDownload(
      storageKey,
      token,
      exp,
    );
 
    const filename = path.basename(storageKey);
    // Plan H — honour optional disposition; default to inline (preview).
    const d = disposition === 'attachment' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${d}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
 
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  }
}