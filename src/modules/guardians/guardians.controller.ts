import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@ApiTags('Guardians')
@Controller('guardians')
@ApiBearerAuth('access-token')
export class GuardiansController {
  constructor(private readonly guardiansService: GuardiansService) {}

  @Get('dashboard')
  @Roles('PARENT' as any)
  @ApiOperation({
    summary: 'Get master parent dashboard',
    description: 'Returns all children and invoices linked to the logged-in parent',
  })
  async getDashboard(@TenantId() tenantId: string, @CurrentUser() user: any) {
    return this.guardiansService.getDashboard(tenantId, user);
  }
}
