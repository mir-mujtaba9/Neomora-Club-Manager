import { IsNotEmpty, IsOptional, IsUUID, IsDateString } from 'class-validator';

export class FindFunnelReportDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsNotEmpty()
  @IsDateString()
  startDate!: string;

  @IsNotEmpty()
  @IsDateString()
  endDate!: string;
}
