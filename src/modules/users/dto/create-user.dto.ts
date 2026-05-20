import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { UserRole } from '../../../common/constants/user-role.constants.js';

export class CreateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @ValidateIf((o: CreateUserDto) => o.role === UserRole.LOCATION_MANAGER)
  @IsUUID()
  locationId?: string;
}
