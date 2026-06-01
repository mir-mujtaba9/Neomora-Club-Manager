import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDir(p: string) {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }

  async uploadDocument(
    tenantId: string,
    user: any,
    participantId: string,
    file: any,
    docType: string,
    notes?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');

    const participant = await this.prisma.participant.findFirst({ where: { id: participantId, tenantId, deletedAt: null } });
    if (!participant) throw new NotFoundException('Participant not found');

    // location manager can only upload for participants in their location
    if (user.role === 'LOCATION_MANAGER' && user.locationId !== participant.locationId) {
      throw new BadRequestException('Not allowed to upload for participant in different location');
    }

    // Construct storage key
    const filename = file.originalname;
    const storageKey = `${tenantId}/${participantId}/${docType}/${filename}`;

    // Save file locally under ./storage/{storageKey}
    const localBase = path.join(process.cwd(), 'storage');
    const localPath = path.join(localBase, tenantId, participantId, docType);
    this.ensureDir(localPath);

    const destPath = path.join(localPath, filename);

    // Move uploaded temp file (Multer saved it to disk) or write buffer
    if (file.path) {
      // file was stored on disk by multer
      fs.renameSync(file.path, destPath);
    } else if (file.buffer) {
      fs.writeFileSync(destPath, file.buffer);
    } else {
      throw new BadRequestException('Uploaded file missing');
    }

    // Create DB record
    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        participantId,
        docType: docType as any,
        storageKey,
        // notes are not part of schema, so store as part of audit via staffNote optional? We'll ignore notes field for now.
      },
    });

    return { id: doc.id, storageKey };
  }
}
