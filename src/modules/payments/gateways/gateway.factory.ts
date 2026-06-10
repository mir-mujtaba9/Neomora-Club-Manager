import { Injectable, Logger } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service.js';
import type { PaymentGatewayStrategy } from './gateway.interface.js';
import { OfflineGateway } from './offline.gateway.js';
import { MoyasarGateway } from './moyasar.gateway.js';
import { PayTabsGateway } from './paytabs.gateway.js';
import { HyperPayGateway } from './hyperpay.gateway.js';

/**
 * Resolves the right gateway strategy for a tenant or a webhook call.
 *
 * Resolution rules:
 *   • `forTenant(tenantId)` reads `tenant.defaultPaymentGateway` and
 *     returns that strategy. If the tenant hasn't picked one, falls
 *     back to OFFLINE so the link service can always succeed.
 *   • `byGateway(enum)` is used by the webhook controller — it routes
 *     `/webhooks/payments/moyasar` to the MoyasarGateway regardless
 *     of which tenant the event later resolves to.
 */
@Injectable()
export class PaymentGatewayFactory {
  private readonly logger = new Logger(PaymentGatewayFactory.name);
  private readonly strategies: Record<PaymentGateway, PaymentGatewayStrategy>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly offline: OfflineGateway,
    private readonly moyasar: MoyasarGateway,
    private readonly paytabs: PayTabsGateway,
    private readonly hyperpay: HyperPayGateway,
  ) {
    this.strategies = {
      [PaymentGateway.OFFLINE]: offline,
      [PaymentGateway.MOYASAR]: moyasar,
      [PaymentGateway.PAYTABS]: paytabs,
      [PaymentGateway.HYPERPAY]: hyperpay,
    };
  }

  byGateway(gateway: PaymentGateway): PaymentGatewayStrategy {
    return this.strategies[gateway];
  }

  async forTenant(tenantId: string): Promise<PaymentGatewayStrategy> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultPaymentGateway: true },
    });
    const choice = tenant?.defaultPaymentGateway ?? PaymentGateway.OFFLINE;
    return this.strategies[choice];
  }
}
