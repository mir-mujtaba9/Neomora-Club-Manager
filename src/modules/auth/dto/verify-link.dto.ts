import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyLinkDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
