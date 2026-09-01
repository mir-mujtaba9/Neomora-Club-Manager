import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { NotificationsService } from './notifications.service.js';

@Controller('automations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AutomationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('templates')
  @Roles(UserRole.SUPER_ADMIN)
  async getTemplates(@TenantId() tenantId: string) {
    return this.notificationsService.getTemplates(tenantId);
  }

  @Post('templates')
  @Roles(UserRole.SUPER_ADMIN)
  async createTemplate(
    @TenantId() tenantId: string,
    @Body() body: { name: string; category: string; language: string; body: string },
  ) {
    return this.notificationsService.createTemplate(tenantId, body);
  }

  @Get('rules')
  @Roles(UserRole.SUPER_ADMIN)
  async getRules(@TenantId() tenantId: string) {
    return this.notificationsService.getRules(tenantId);
  }

  @Post('rules')
  @Roles(UserRole.SUPER_ADMIN)
  async createRule(
    @TenantId() tenantId: string,
    @Body() body: { trigger: string; templateId: string; channel: string },
  ) {
    return this.notificationsService.createRule(tenantId, body);
  }
}
