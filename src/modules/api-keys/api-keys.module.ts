import { Module } from '@nestjs/common';

import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

/**
 * Plan K (F-34) — API-key management module.
 *
 * The guard that consumes API keys lives in `common/guards/`
 * (`JwtOrApiKeyGuard`) so it can be used freely without depending on
 * this module's exports. This module only provides the CRUD surface.
 */
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
