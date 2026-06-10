import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { FeesService } from './fees.service.js';
import { CreateEnrolmentPlanDto } from './dto/create-enrolment-plan.dto.js';
import { SetFeeOverrideDto } from './dto/set-fee-override.dto.js';

/**
 * Plan F — admin / staff routes for fees and invoices.
 *
 *   POST   /enrolments/:id/payment-plan       → create plan + invoices
 *   GET    /enrolments/:id/invoices           → list invoices
 *   PATCH  /enrolments/:id/fee-override       → set / clear custom fee
 *
 * Public / guardian portal routes for paying invoices live in the
 * portal module (Plan F-7 payment link) — this controller is staff-only.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeesController {
  constructor(private readonly feesService: FeesService) {}

  @Post('enrolments/:enrolmentId/payment-plan')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER, UserRole.LOCATION_MANAGER)
  async createPlan(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('enrolmentId') enrolmentId: string,
    @Body() dto: CreateEnrolmentPlanDto,
  ) {
    return this.feesService.createPlanForEnrolment(
      enrolmentId,
      tenantId,
      user,
      dto.planType,
      dto.instalmentCount,
    );
  }

  @Get('enrolments/:enrolmentId/invoices')
  async listInvoices(
    @TenantId() tenantId: string,
    @CurrentUser() user: { role: UserRole; locationId?: string | null },
    @Param('enrolmentId') enrolmentId: string,
  ) {
    return this.feesService.listInvoices(enrolmentId, tenantId, user);
  }

  @Patch('enrolments/:enrolmentId/fee-override')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  async setOverride(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('enrolmentId') enrolmentId: string,
    @Body() dto: SetFeeOverrideDto,
  ) {
    return this.feesService.setFeeOverride(
      enrolmentId,
      tenantId,
      user,
      dto.amount ?? null,
      dto.reason,
    );
  }
}
