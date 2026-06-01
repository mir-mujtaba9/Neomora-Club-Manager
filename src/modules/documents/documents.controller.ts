import {
  Body,
  BadRequestException,
  Controller,
  Param,
  Post,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { DocumentsService } from './documents.service.js';
import { DOCUMENT_TYPE } from '../../common/constants/document-type.constants.js';

// simple filename sanitizer
function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post(':participantId')
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file: any, cb: any) => {
          // save to temp uploads dir; service will move to final location
          const tmp = './uploads/tmp';
          try {
            require('fs').mkdirSync(tmp, { recursive: true });
          } catch (e) {}
          cb(null, tmp);
        },
        filename: (req: any, file: any, cb: any) => {
          const name = sanitizeFilename(file.originalname);
          cb(null, `${Date.now()}_${name}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

    return this.documentsService.uploadDocument(tenantId, user, participantId, file, docType, notes);
  }
}
