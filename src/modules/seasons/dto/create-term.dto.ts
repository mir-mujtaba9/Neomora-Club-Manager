import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTermDto {
  @ApiProperty({ description: 'Location this term runs at' })
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  termNumber!: number;

  @ApiProperty({ example: '2025-09-01' })
  @IsISO8601()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({ example: '2025-12-15' })
  @IsISO8601()
  @IsNotEmpty()
  endDate!: string;

  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalWeeks!: number;
}
