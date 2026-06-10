import { Controller, Post, Get, Patch, Body, Query, Param, UseGuards } from '@nestjs/common';
import { LocationsService } from './locations.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { FindLocationsDto } from './dto/find-locations.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, Public } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locationsService.create(tenantId, dto);
  }

  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Query() query: FindLocationsDto,
  ) {
    return this.locationsService.findAll(tenantId, user, query);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(tenantId, id, user, dto);
  }

  @Post(':id/regenerate-qr')
  @Roles(UserRole.SUPER_ADMIN, UserRole.LOCATION_MANAGER)
  async regenerateQr(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.locationsService.regenerateQr(tenantId, id, user);
  }

  @Public()
  @Get(':slug/register')
  async getRegistrationConfig(@Param('slug') slug: string) {
    return this.locationsService.getRegistrationConfig(slug);
  }
}
