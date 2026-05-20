import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { UserRole } from '../../../common/constants/user-role.constants.js';

export class UpdateUserDto {
	@IsOptional()
	@IsEnum(UserRole)
	role?: UserRole;

	@IsOptional()
	@IsUUID()
	locationId?: string;
}
