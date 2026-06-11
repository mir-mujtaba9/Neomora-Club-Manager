import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { AuditChainService } from './audit-chain.service.js';

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly chain: AuditChainService) {}

  /**
   * Plan J (F-32) — chain verification endpoint. SUPER_ADMIN only;
   * exposing this to other roles would let them deduce write volume
   * from the `checked` counter. Returns `{ok:true, checked:N}` when
   * the chain matches, or `{ok:false, firstBadId, reason}` when an
   * insertion or mutation has broken the chain.
   */
  @Get('verify-chain')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Verify the audit hash chain for this tenant',
    description:
      'Walks every AuditLog row with `hashSelf IS NOT NULL` in createdAt order, recomputes the expected SHA-256, and returns `{ok, checked, firstBadId?, reason?}`.',
  })
  async verifyChain(@TenantId() tenantId: string) {
    return this.chain.verify(tenantId);
  }
}
