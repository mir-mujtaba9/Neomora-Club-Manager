import { Body, Controller, Post, UseGuards, Param, Get, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { EnrolmentsService } from './enrolments.service.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { ReEnrolDto } from './dto/re-enrol.dto.js';
import { FindEnrolmentsDto } from './dto/find-enrolments.dto.js';

@Controller('enrolments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrolmentsController {
  constructor(private readonly enrolmentsService: EnrolmentsService) {}

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindEnrolmentsDto,
  ) {
    return this.enrolmentsService.findAll(tenantId, user, query);
  }

  @Post()
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  async enrol(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateEnrolmentDto,
    @Query('allowOverlap') allowOverlap?: string,
  ) {
    // Only SUPER_ADMIN and FINANCE_OFFICER may bypass the overlap guard.
    const wantsBypass = allowOverlap === 'true';
    const canBypass =
      user?.role === UserRole.SUPER_ADMIN || user?.role === UserRole.FINANCE_OFFICER;
    return this.enrolmentsService.enrol(tenantId, user, dto, {
      allowOverlap: wantsBypass && canBypass,
    });
  }

  @Post(':id/re-enrol')
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  async reEnrol(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReEnrolDto,
    @Query('allowOverlap') allowOverlap?: string,
  ) {
    const wantsBypass = allowOverlap === 'true';
    const canBypass =
      user?.role === UserRole.SUPER_ADMIN || user?.role === UserRole.FINANCE_OFFICER;
    return this.enrolmentsService.reEnrol(tenantId, user, id, dto, {
      allowOverlap: wantsBypass && canBypass,
    });
  }
}
