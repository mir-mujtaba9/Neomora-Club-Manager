import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Public, Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { WaitlistService } from './waitlist.service.js';
import { FindWaitlistDto } from './dto/find-waitlist.dto.js';
import {
  AcceptWaitlistOfferDto,
  WaitlistTokenDto,
} from './dto/waitlist-offer.dto.js';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  // ─── Staff endpoints (JWT-guarded) ──────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async getWaitlist(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindWaitlistDto,
  ) {
    return this.waitlistService.getWaitlist(tenantId, user, query);
  }

  @Post(':id/offer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async sendOffer(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.waitlistService.sendOffer(tenantId, id, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async staffWithdraw(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.waitlistService.staffWithdraw(tenantId, id, user);
  }

  // ─── Public guardian endpoints (token-auth) ─────────────────────────

  @Public()
  @Post('accept')
  async acceptOffer(@Body() dto: AcceptWaitlistOfferDto) {
    return this.waitlistService.acceptOffer(dto.token, dto.paymentPlanType);
  }

  @Public()
  @Post('decline')
  async declineOffer(@Body() dto: WaitlistTokenDto) {
    return this.waitlistService.declineOffer(dto.token);
  }

  @Public()
  @Post('withdraw')
  async guardianWithdraw(@Body() dto: WaitlistTokenDto) {
    return this.waitlistService.guardianWithdraw(dto.token);
  }
}
