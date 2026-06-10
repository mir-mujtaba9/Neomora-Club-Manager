import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { PaymentsService } from './payments.service.js';
import { RecordOfflinePaymentDto } from './dto/record-offline-payment.dto.js';
import { RejectPaymentDto } from './dto/reject-payment.dto.js';
import { FindPaymentsDto } from './dto/find-payments.dto.js';

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Plan F — staff payments endpoints.
 *
 *   POST  /payments/proof-upload  → upload proof (returns storageKey)
 *   POST  /payments/offline       → record offline payment (PENDING_VERIFICATION)
 *   POST  /payments/:id/verify    → mark COMPLETED, apply funds
 *   POST  /payments/:id/reject    → mark FAILED
 *   GET   /payments               → list (filtered by role)
 *   GET   /payments/:id           → single
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ─── F-15 proof upload ────────────────────────────────────────────

  /**
   * Upload a proof-of-payment file. Returns `{ storageKey }` that the
   * caller passes into POST /payments/offline. Two-step upload avoids
   * having to multipart-encode the entire payment payload.
   */
  @Post('proof-upload')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER, UserRole.LOCATION_MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: any, _file: any, cb: any) => {
          const tmp = './uploads/tmp';
          try {
            fs.mkdirSync(tmp, { recursive: true });
          } catch {}
          cb(null, tmp);
        },
        filename: (_req: any, file: any, cb: any) => {
          const safe = sanitizeFilename(file.originalname);
          cb(null, `${Date.now()}_${safe}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async uploadProof(
    @TenantId() tenantId: string,
    @UploadedFile() file: any,
    @Body('enrolmentId') enrolmentId: string,
  ): Promise<{ storageKey: string }> {
    if (!file) throw new BadRequestException('file is required');
    if (!enrolmentId) throw new BadRequestException('enrolmentId is required');

    // Move the temp file into the canonical storage layout
    //   storage/proofs/{tenantId}/{enrolmentId}/{filename}
    const storageRoot = path.join(process.cwd(), 'storage');
    const targetDir = path.join(storageRoot, 'proofs', tenantId, enrolmentId);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(file.path));
    fs.renameSync(file.path, targetPath);

    const storageKey = path.posix.join(
      'proofs',
      tenantId,
      enrolmentId,
      path.basename(file.path),
    );
    return { storageKey };
  }

  // ─── F-15 record offline ──────────────────────────────────────────

  @Post('offline')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER, UserRole.LOCATION_MANAGER)
  async recordOffline(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole; locationId?: string | null },
    @Body() dto: RecordOfflinePaymentDto,
  ) {
    return this.paymentsService.recordOffline(tenantId, user, {
      enrolmentId: dto.enrolmentId,
      invoiceId: dto.invoiceId,
      method: dto.method,
      amount: dto.amount,
      proofKey: dto.proofKey,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  // ─── F-15 verify / reject ─────────────────────────────────────────

  @Post(':id/verify')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  async verify(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('id') id: string,
  ) {
    return this.paymentsService.verify(tenantId, user, id);
  }

  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  async reject(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.paymentsService.reject(tenantId, user, id, dto.reason);
  }

  // ─── reads ────────────────────────────────────────────────────────

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: { role: UserRole; locationId?: string | null },
    @Query() query: FindPaymentsDto,
  ) {
    return this.paymentsService.findAll(tenantId, user, query);
  }

  @Get(':id')
  async findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.paymentsService.findOne(tenantId, id);
  }
}
