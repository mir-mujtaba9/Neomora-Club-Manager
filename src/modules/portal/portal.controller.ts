import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator.js';
import { ParticipantsService } from '../participants/participants.service.js';

@Controller('portal')
export class PortalController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    return this.participantsService.getPortalByToken(token);
  }
}
