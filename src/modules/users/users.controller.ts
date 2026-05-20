import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';

import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { FindUsersDto } from './dto/find-users.dto.js';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Post()
	@Roles(UserRole.SUPER_ADMIN)
	async create(@TenantId() tenantId: string, @Body() dto: CreateUserDto) {
		return this.usersService.create(tenantId, dto);
	}

	@Get()
	@Roles(UserRole.SUPER_ADMIN)
	async findAll(@TenantId() tenantId: string, @Query() query: FindUsersDto) {
		return this.usersService.findAll(tenantId, query);
	}

	@Get(':id')
	@Roles(UserRole.SUPER_ADMIN)
	async findById(@TenantId() tenantId: string, @Param('id') id: string) {
		return this.usersService.findById(tenantId, id);
	}
}
