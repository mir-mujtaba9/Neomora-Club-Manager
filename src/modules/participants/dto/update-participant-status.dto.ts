import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { PARTICIPANT_STATUS } from '../../../common/constants/participant-status.constants.js';

export class UpdateParticipantStatusDto {
  @IsEnum(PARTICIPANT_STATUS as unknown as object)
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
