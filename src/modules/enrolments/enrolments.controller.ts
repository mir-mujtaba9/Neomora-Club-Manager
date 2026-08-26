import { Body, Controller, Post, UseGuards, Param, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CalculateFeeDto } from './dto/calculate-fee.dto.js';
import { StaffRegisterDto } from './dto/staff-register.dto.js';
import { GetAvailableTermsDto } from './dto/get-available-terms.dto.js';

@ApiTags('Enrolments')
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

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.enrolmentsService.findOne(tenantId, id);
  }

  @Post()
  @Roles(UserRole.LOCATION_MANAGER, UserRole.SUPER_ADMIN)
  async enrol(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateEnrolmentDto,
    @Query('allowOverlap') allowOverlap?: string,
  ) {
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

  // ─── Staff registration form endpoints ───────────────────────────────────

  @Get('available-terms')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
  @ApiOperation({
    summary: 'List terms available for staff registration',
    description:
      'Returns terms offered at the given location that are still open for enrolment ' +
      '(endDate has not passed, status is not CLOSED or ARCHIVED). ' +
      'Used to populate the term picker in the staff registration form.',
  })
  async getAvailableTerms(
    @TenantId() tenantId: string,
    @Query() query: GetAvailableTermsDto,
  ) {
    return this.enrolmentsService.getAvailableTerms(tenantId, query);
  }

  @Post('calculate-fee')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER, UserRole.STAFF)
  @ApiOperation({
    summary: 'Live fee calculation (calculateFee engine)',
    description:
      'No side effects — pure calculation. Used by the "Live Fee Summary" panel in the ' +
      'staff registration form. Call whenever location, program, term, join date, ' +
      'commitment length, or kit option changes.',
  })
  async calculateFee(
    @TenantId() tenantId: string,
    @Body() dto: CalculateFeeDto,
  ) {
    return this.enrolmentsService.calculateFee(tenantId, dto);
  }

  @Post('staff-register')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER, UserRole.FINANCE_OFFICER)
  @ApiOperation({
    summary: 'Staff-side "Register Student" form submission',
    description:
      'Single endpoint for the admin registration form. Handles: ' +
      'create or reuse existing participant, create or reuse existing guardian/family, ' +
      'allocate seat, create invoice, and optionally record payment at registration. ' +
      'Returns enrolment + invoice + optional payment in one response.',
  })
  async staffRegister(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: StaffRegisterDto,
  ) {
    return this.enrolmentsService.staffRegister(tenantId, user, dto);
  }
}
