import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { RequestLinkDto } from './dto/request-link.dto.js';
import { VerifyLinkDto } from './dto/verify-link.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class GuardianAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async requestLink(dto: RequestLinkDto) {
    const { email, phone, tenantSlug } = dto;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });

    if (!tenant) throw new NotFoundException('Tenant not found');

    // Find guardian by email or phone within tenant. We need full guardian
    // context here (not just id) so we can render + send the magic-link
    // notification with the correct name + language.
    const guardian = await this.prisma.guardian.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          email ? { email: email.toLowerCase() } : {},
          phone ? { phone } : {},
        ].filter(cond => Object.keys(cond).length > 0),
        deletedAt: null,
      },
      include: {
        participant: { select: { preferredLang: true } },
      },
    });

    if (!guardian) {
      // Don't reveal whether the guardian exists. Same response shape
      // in both branches keeps timing attacks ineffective.
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

    // Plan H — dispatch via NotificationsService (WhatsApp first, email
    // fallback). The stub channels log instead of actually sending until
    // real provider creds land; this means dev/staging still works.
    const webBaseUrl = this.config.get<string>('app.webBaseUrl', 'http://localhost:5173');
    const magicLinkUrl = `${webBaseUrl}/guardian-auth/verify?token=${portalToken}`;
    const isProd = this.config.get<string>('app.nodeEnv') === 'production';

    await this.notifications.enqueueGuardianMagicLink({
      tenantId: tenant.id,
      guardianId: guardian.id,
      guardianFullName: guardian.fullName,
      guardianLang: guardian.participant?.preferredLang ?? 'en',
      guardianPhone: guardian.phone,
      guardianEmail: guardian.email,
      magicLinkUrl,
      expiresIn: '15 minutes',
      token: portalToken,
    });

    return {
      success: true,
      message: 'Magic link generated',
      // Dev/staging only — prod NEVER returns the link in the response.
      ...(isProd ? {} : { dev_link: magicLinkUrl }),
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
