import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { PaymentLinkService } from './payment-link.service.js';

/**
 * Plan F — invoice routes that drive payment-link issuance.
 *
 * `POST /invoices/:id/payment-link` — generate (or refresh) a
 * checkout URL and notify the guardian. Safe to call repeatedly.
 *
 * `GET  /invoices/:id/payment-link` — read back the latest stored
 * link without re-issuing. Useful for the dashboard's "preview"
 * button so staff can copy the URL without spamming the guardian.
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly paymentLink: PaymentLinkService) {}

  @Post(':id/payment-link')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER, UserRole.LOCATION_MANAGER)
  async issue(
    @TenantId() tenantId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.paymentLink.issueLinkForInvoice(tenantId, invoiceId);
  }
}
