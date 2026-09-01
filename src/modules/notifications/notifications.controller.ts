import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { NotificationsService } from './notifications.service.js';
import { FindNotificationsDto } from './dto/find-notifications.dto.js';

/**
 * Admin-only read + retry endpoints. There is intentionally NO public POST:
 * notifications are created server-side as side effects of domain actions
 * (registration, payment, enrolment changes). Exposing a public "create"
 * would let any authenticated user spam guardians/admins.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindNotificationsDto,
  ) {
    return this.notificationsService.findAll(tenantId, user, query);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.findOne(tenantId, id);
  }

  /**
   * Manually re-dispatch a FAILED notification (e.g., after the provider
   * incident is resolved). Returns the updated row so the dashboard can
   * refresh in-place.
   */
  @Post(':id/retry')
  @Roles(UserRole.SUPER_ADMIN)
  async retry(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.retry(tenantId, id);
  }

  @Post('whatsapp/exchange-code')
  @Roles(UserRole.SUPER_ADMIN)
  async exchangeWhatsAppCode(
    @TenantId() tenantId: string,
    @Req() req: Request,
  ) {
    const code = req.body?.code || req.query?.code;
    const accessToken = req.body?.accessToken || req.query?.accessToken;
    const wabaId = req.body?.wabaId || req.query?.wabaId;
    const phoneNumberId = req.body?.phoneNumberId || req.query?.phoneNumberId;

    if (!(code || accessToken) || !wabaId || !phoneNumberId) {
      return { success: false, error: 'Missing parameters' };
    }

    let currentToken = accessToken;

    if (code) {
      const tokenRes = await fetch(`https://graph.facebook.com/v25.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&code=${code}`);
      const tokenData = await (tokenRes.json() as Promise<any>);
      if (!tokenData.access_token) return { success: false, error: 'Token exchange failed', details: tokenData };
      currentToken = tokenData.access_token;
    }

    const longLivedRes = await fetch(`https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${currentToken}`);
    const longLivedData = await (longLivedRes.json() as Promise<any>);
    const finalToken = longLivedData.access_token || currentToken;

    await fetch(`https://graph.facebook.com/v25.0/${wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${finalToken}` }});
    
    await this.notificationsService.updateWhatsAppConnection(tenantId, wabaId, phoneNumberId, finalToken);

    return { success: true, wabaId, phoneNumberId };
  }
}
