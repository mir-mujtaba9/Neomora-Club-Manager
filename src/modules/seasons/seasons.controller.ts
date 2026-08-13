import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantId } from '../../common/decorators/tenant.decorator.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { SeasonsService } from './seasons.service.js';
import { CreateSeasonDto } from './dto/create-season.dto.js';
import { UpdateSeasonDto } from './dto/update-season.dto.js';
import { FindSeasonsDto } from './dto/find-seasons.dto.js';
import { CreateTermDto } from './dto/create-term.dto.js';
import { UpdateTermDto } from './dto/update-term.dto.js';
import { RenewTermDto } from './dto/renew-term.dto.js';

@ApiTags('Seasons')
@ApiBearerAuth('access-token')
@Controller('seasons')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) {}

  // ─── Seasons ───────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a season' })
  create(@TenantId() tenantId: string, @Body() dto: CreateSeasonDto) {
    return this.seasonsService.createSeason(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List seasons with term counts' })
  findAll(@TenantId() tenantId: string, @Query() query: FindSeasonsDto) {
    return this.seasonsService.findAll(tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get season with its terms and enrolment counts' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.seasonsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update season name, dates, or status' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSeasonDto,
  ) {
    return this.seasonsService.updateSeason(tenantId, id, dto);
  }

  // ─── Terms ─────────────────────────────────────────────────────────────────

  @Post(':id/terms')
  @ApiOperation({ summary: 'Create a term within a season at a specific branch' })
  createTerm(
    @TenantId() tenantId: string,
    @Param('id') seasonId: string,
    @Body() dto: CreateTermDto,
  ) {
    return this.seasonsService.createTerm(tenantId, seasonId, dto);
  }

  @Patch(':id/terms/:termId')
  @ApiOperation({ summary: 'Update a term — dates, totalWeeks, or advance status' })
  updateTerm(
    @TenantId() tenantId: string,
    @Param('id') seasonId: string,
    @Param('termId') termId: string,
    @Body() dto: UpdateTermDto,
  ) {
    return this.seasonsService.updateTerm(tenantId, seasonId, termId, dto);
  }

  @Delete(':id/terms/:termId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a term' })
  deleteTerm(
    @TenantId() tenantId: string,
    @Param('id') seasonId: string,
    @Param('termId') termId: string,
  ) {
    return this.seasonsService.deleteTerm(tenantId, seasonId, termId);
  }

  // ─── Renewal ───────────────────────────────────────────────────────────────

  @Post(':id/terms/:termId/renew')
  @ApiOperation({
    summary: 'Bulk-renew enrolments into a new term',
    description:
      'Copies all ACTIVE / FEE_PENDING / DOCUMENTS_PENDING enrolments from the source term ' +
      'into the target term. Each new enrolment starts at FEE_PENDING. ' +
      'Fee is recalculated as `Program.baseFeePerWeek × targetTerm.totalWeeks` when the programme ' +
      'has a weekly rate set; otherwise the previous term fee is carried forward. ' +
      'Participants already enrolled in the target term are silently skipped. ' +
      'The target term must be in DRAFT or OPEN status.',
  })
  renewTerm(
    @TenantId() tenantId: string,
    @Param('id') seasonId: string,
    @Param('termId') targetTermId: string,
    @Body() dto: RenewTermDto,
  ) {
    return this.seasonsService.renewTerm(tenantId, seasonId, targetTermId, dto);
  }
}
