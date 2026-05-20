import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { RequestLinkDto } from './dto/request-link.dto.js';
import { VerifyLinkDto } from './dto/verify-link.dto.js';

@Injectable()
export class GuardianAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async requestLink(dto: RequestLinkDto) {
    const { email, phone, tenantSlug } = dto;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');

    // Find guardian by email or phone within tenant
    const guardian = await this.prisma.guardian.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          email ? { email: email.toLowerCase() } : {},
          phone ? { phone } : {},
        ].filter(cond => Object.keys(cond).length > 0),
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!guardian) {
      // For security, don't reveal if guardian exists. 
      // In production, you'd trigger an email/SMS here if found.
      return { success: true, message: 'If you are registered, a link has been sent.' };
    }

    const portalToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await this.prisma.guardian.update({
      where: { id: guardian.id },
      data: {
        portalToken,
        portalTokenExpiresAt: expiresAt,
      },
    });

    // TODO: Integrate with Notification Service to send the link
    // For now, return it in the response for development/testing
    return {
      success: true,
      message: 'Magic link generated',
      dev_link: `/guardian-auth/verify?token=${portalToken}`, // Only for dev
    };
  }

  async verifyLink(dto: VerifyLinkDto) {
    const { token } = dto;

    const guardian = await this.prisma.guardian.findFirst({
      where: {
        portalToken: token,
        portalTokenExpiresAt: { gt: new Date() },
        deletedAt: null,
      },
      include: {
        participant: {
          select: { id: true, firstNameEn: true, lastNameEn: true }
        }
      }
    });

    if (!guardian) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    // Clear token after use (one-time use)
    await this.prisma.guardian.update({
      where: { id: guardian.id },
      data: {
        portalToken: null,
        portalTokenExpiresAt: null,
      },
    });

    const payload = {
      sub: guardian.id,
      email: guardian.email,
      actorType: 'GUARDIAN',
      tenantId: guardian.tenantId,
      participantId: guardian.participantId,
      role: 'GUARDIAN', // Synthetic role for guards if needed
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      guardian: {
        id: guardian.id,
        fullName: guardian.fullName,
        participantName: `${guardian.participant.firstNameEn} ${guardian.participant.lastNameEn}`,
      },
    };
  }
}
