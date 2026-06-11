import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';

/**
 * Plan K (F-34) — `GET/POST/DELETE /api-keys`.
 *
 * Intentionally restricted to SUPER_ADMIN for the entire tenant. Issuing
 * a partner-facing credential is a security-sensitive op and should not
 * be delegated to LM / Finance.
 *
 * NOTE: this controller is JWT-only — API keys cannot manage other API
 * keys (no recursion). Verified by `JwtAuthGuard` at class level (not
 * `JwtOrApiKeyGuard`).
 */
@ApiTags('API Keys')
@ApiBearerAuth('access-token')
@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({
    summary: 'Issue a new API key',
    description:
      'Returns the plaintext key in the `plaintext` field. **This is the only time it is shown** — the DB stores only an HMAC-SHA256 hash. Scopes follow `<resource>:<verb>` (e.g. `participants:read`).',
  })
  @ApiResponse({ status: 201, description: 'Created. Plaintext key returned in `plaintext`.' })
  async create(
    @TenantId() tenantId: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(tenantId, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List API keys (metadata only, never plaintext)' })
  async findAll(@TenantId() tenantId: string) {
    return this.apiKeysService.findAll(tenantId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Revoke an API key',
    description: 'Soft-delete via `revokedAt`. The key stops working immediately on the next request.',
  })
  async revoke(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.apiKeysService.revoke(tenantId, id);
  }
}
