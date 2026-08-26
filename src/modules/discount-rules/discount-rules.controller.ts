import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { DiscountRulesService } from './discount-rules.service.js';

@ApiTags('DiscountRules')
@ApiBearerAuth('access-token')
@Controller('discount-rules')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
export class DiscountRulesController {
  constructor(private readonly discountRulesService: DiscountRulesService) {}

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.discountRulesService.create(tenantId, dto);
  }

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('programId') programId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.discountRulesService.findAll(tenantId, programId, pageNum, limitNum);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.discountRulesService.remove(tenantId, id);
  }

  @Post(':id/toggle')
  toggle(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.discountRulesService.toggle(tenantId, id);
  }
}
