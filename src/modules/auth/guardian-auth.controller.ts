import { Body, Controller, Post, UseGuards, Get } from '@nestjs/common';
import { GuardianAuthService } from './guardian-auth.service.js';
import { RequestLinkDto } from './dto/request-link.dto.js';
import { VerifyLinkDto } from './dto/verify-link.dto.js';
import { Public } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

@Controller('guardian-auth')
export class GuardianAuthController {
  constructor(private readonly guardianAuthService: GuardianAuthService) {}

  @Public()
  @Post('request-link')
  async requestLink(@Body() dto: RequestLinkDto) {
    return this.guardianAuthService.requestLink(dto);
  }

  @Public()
  @Post('verify')
  async verifyLink(@Body() dto: VerifyLinkDto) {
    return this.guardianAuthService.verifyLink(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() actor: any) {
    if (actor.actorType !== 'GUARDIAN') {
      throw new Error('Not a guardian session');
    }
    return actor;
  }
}
