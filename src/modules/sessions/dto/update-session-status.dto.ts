import { IsEnum, IsNotEmpty } from 'class-validator';
import { SessionStatus } from '../../../common/constants/session-status.constants.js';

export class UpdateSessionStatusDto {
  @IsEnum(SessionStatus)
  @IsNotEmpty()
  status!: SessionStatus;
}
