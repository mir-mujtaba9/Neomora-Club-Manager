import { IsNotEmpty, IsUUID } from 'class-validator';

export class FindWaitlistDto {
  @IsNotEmpty()
  @IsUUID()
  sessionId!: string;

  @IsNotEmpty()
  @IsUUID()
  locationId!: string;
}
