import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { NotificationsService } from './notifications.service.js';
import { FindNotificationsDto } from './dto/find-notifications.dto.js';

/**
 * Admin-only read + retry endpoints. There is intentionally NO public POST:
 * notifications are created server-side as side effects of domain actions
 * (registration, payment, enrolment changes). Exposing a public "create"
 * would let any authenticated user spam guardians/admins.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindNotificationsDto,
  ) {
    return this.notificationsService.findAll(tenantId, user, query);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.findOne(tenantId, id);
  }

  /**
   * Manually re-dispatch a FAILED notification (e.g., after the provider
   * incident is resolved). Returns the updated row so the dashboard can
   * refresh in-place.
   */
  @Post(':id/retry')
  @Roles(UserRole.SUPER_ADMIN)
  async retry(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.retry(tenantId, id);
  }
}
