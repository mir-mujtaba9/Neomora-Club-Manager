import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { AuditChainService } from './audit-chain.service.js';

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
  async verifyChain(@TenantId() tenantId: string) {
    return this.chain.verify(tenantId);
  }
}
