import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { VatRatesService } from './vat-rates.service.js';

@ApiTags('VatRates')
@ApiBearerAuth('access-token')
@Controller('vat-rates')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
export class VatRatesController {
  constructor(private readonly vatRatesService: VatRatesService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.vatRatesService.findAll(tenantId);
  }

  @Post()
  schedule(@TenantId() tenantId: string, @Body() dto: { rate: number; effectiveFrom: string }) {
    return this.vatRatesService.schedule(tenantId, dto);
  }
}
