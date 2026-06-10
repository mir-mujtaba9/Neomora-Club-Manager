import { Injectable, ConflictException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { FindLocationsDto } from './dto/find-locations.dto.js';
import { slugify } from '../../common/utils/slug.util.js';
import { generateRegistrationQrDataUrl } from '../../common/utils/qr-code.util.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(tenantId: string, dto: CreateLocationDto) {
    const slug = slugify(dto.name);

    // Check if slug is already taken (unique constraint in DB)
    const existing = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
    });

    if (existing) {
      throw new ConflictException(`Registration slug '${slug}' is already in use by another location`);
    }

    const location = await this.prisma.location.create({
      data: {
        ...dto,
        tenantId,
        registrationSlug: slug,
        status: 'active',
      },
    });

    // Generate a QR code for the registration URL. Best-effort: if it fails
    // we still return the location row (caller can retry via regenerateQr).
    const qrCodeUrl = await this.buildQrForSlug(slug).catch((e) => {
      this.logger.error(`QR generation failed for location ${location.id}: ${e.message}`);
      return null;
    });

    if (!qrCodeUrl) return location;

    return this.prisma.location.update({
      where: { id: location.id },
      data: { qrCodeUrl },
    });
  }

  async findAll(tenantId: string, user: any, query: FindLocationsDto) {
    const { status, city, page, limit } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (status) where.status = status;
    if (city) where.city = { contains: city, mode: 'insensitive' };

    // Role-based filtering
    // Location managers see only their assigned location
    if (user.role === UserRole.LOCATION_MANAGER && user.locationId) {
      where.id = user.locationId;
    }

    const [items, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.location.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(tenantId: string, id: string, user: any, dto: UpdateLocationDto) {
    const location = await this.prisma.location.findUnique({
      where: { id },
    });

    if (!location || location.tenantId !== tenantId) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }

    // RBAC: Location Manager can only update their own location
    if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== id) {
      throw new ForbiddenException('You do not have permission to update this location');
    }

    // Role check: Only SUPER_ADMIN or the assigned LOCATION_MANAGER can update
    // (If there are other roles, we might need a more general check, but for now this follows the requirement)

    return this.prisma.location.update({
      where: { id },
      data: dto,
    });
  }

  async getRegistrationConfig(slug: string) {
    const location = await this.prisma.location.findUnique({
      where: { registrationSlug: slug },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!location || location.status !== 'active' || location.deletedAt) {
      throw new NotFoundException(`Location with slug '${slug}' not found or inactive`);
    }

    // Find all OPEN sessions available at this location
    const sessionLocations = await this.prisma.sessionLocation.findMany({
      where: {
        locationId: location.id,
        session: {
          status: 'OPEN',
          deletedAt: null,
          // Only show sessions where enrollment period is active
          OR: [
            { enrolOpenAt: null },
            { enrolOpenAt: { lte: new Date() } },
          ],
          AND: [
            {
              OR: [
                { enrolCloseAt: null },
                { enrolCloseAt: { gte: new Date() } },
              ],
            },
          ],
        },
      },
      include: {
        session: {
          include: {
            paymentPlans: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    const sessions = sessionLocations.map((sl) => ({
      id: sl.session.id,
      name: sl.session.name,
      startDate: sl.session.startDate,
      endDate: sl.session.endDate,
      baseFee: sl.feeOverride || sl.session.baseFee,
      paymentPlans: sl.session.paymentPlans,
    }));

    return {
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        phone: location.phone,
      },
      tenant: location.tenant,
      sessions,
    };
  }

  /**
   * Regenerate the QR code for an existing location. Used to:
   *  (a) backfill rows created before Plan B,
   *  (b) refresh after the WEB_BASE_URL or slug changes,
   *  (c) recover from a failed initial generation.
   */
  async regenerateQr(tenantId: string, id: string, user: any) {
    const location = await this.prisma.location.findUnique({ where: { id } });

    if (!location || location.tenantId !== tenantId || location.deletedAt) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }

    if (user.role === UserRole.LOCATION_MANAGER && user.locationId !== id) {
      throw new ForbiddenException('You do not have permission to regenerate this QR code');
    }

    if (!location.registrationSlug) {
      throw new ConflictException(`Location ${id} has no registration slug`);
    }

    const qrCodeUrl = await this.buildQrForSlug(location.registrationSlug);

    return this.prisma.location.update({
      where: { id },
      data: { qrCodeUrl },
    });
  }

  private async buildQrForSlug(slug: string): Promise<string> {
    const webBaseUrl = this.config.get<string>('app.webBaseUrl') || 'http://localhost:5173';
    return generateRegistrationQrDataUrl(webBaseUrl, slug);
  }
}
