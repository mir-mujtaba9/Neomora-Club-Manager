import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ReportingService } from './reporting.service.js';
import { FindFeesReportDto } from './dto/find-fees-report.dto.js';
import { FindFunnelReportDto } from './dto/find-funnel-report.dto.js';
import { FindRevenueReportDto } from './dto/find-revenue-report.dto.js';

@Controller('reporting')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('dashboard')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.LOCATION_MANAGER,
    UserRole.FINANCE_OFFICER,
    UserRole.STAFF,
  )
  async getDashboard(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
  ) {
    return this.reportingService.getDashboard(tenantId, user);
  }

  @Get('fees')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  async getFeesReport(
    @TenantId() tenantId: string,
    @Query() query: FindFeesReportDto,
  ) {
    return this.reportingService.getFeesReport(tenantId, query);
  }

  @Get('funnel')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.LOCATION_MANAGER,
    UserRole.FINANCE_OFFICER,
    UserRole.STAFF,
  )
  async getFunnelReport(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindFunnelReportDto,
  ) {
    return this.reportingService.getFunnelReport(tenantId, user, query);
  }

  @Get('revenue')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  async getRevenueReport(
    @TenantId() tenantId: string,
    @Query() query: FindRevenueReportDto,
  ) {
    return this.reportingService.getRevenueReport(tenantId, query);
  }
}
