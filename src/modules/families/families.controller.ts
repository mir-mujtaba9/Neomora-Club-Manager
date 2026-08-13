import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { FamiliesService } from './families.service.js';

@ApiTags('Families')
@ApiBearerAuth('access-token')
@Controller('families')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Get('search')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
  @ApiOperation({
    summary: 'Search families by guardian name, phone, or email',
    description:
      'Returns up to 10 family groups. Each group has a guardian contact and a list of ' +
      'their linked participants (students). Use this to avoid duplicate registrations and to ' +
      'attach a new student to an existing family.',
  })
  @ApiQuery({ name: 'q', description: 'Guardian name, phone number, or email address', required: true })
  async search(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query('q') q: string,
  ) {
    return this.familiesService.search(tenantId, user, q ?? '');
  }
}
