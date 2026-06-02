import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { WaitlistService } from './waitlist.service.js';
import { FindWaitlistDto } from './dto/find-waitlist.dto.js';

@Controller('waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async getWaitlist(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindWaitlistDto,
  ) {
    return this.waitlistService.getWaitlist(tenantId, user, query);
  }
}
