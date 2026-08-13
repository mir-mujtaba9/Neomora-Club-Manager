import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RenewTermDto {
  @ApiProperty({
    description:
      'ID of the term whose ACTIVE enrolments will be copied into the target term',
    example: 'uuid-of-previous-term',
  })
  @IsString()
  @IsNotEmpty()
  sourceTermId!: string;
}
