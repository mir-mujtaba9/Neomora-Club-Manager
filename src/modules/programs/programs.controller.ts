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
import { ProgramsService } from './programs.service.js';
import { CreateProgramDto } from './dto/create-program.dto.js';
import { UpdateProgramDto } from './dto/update-program.dto.js';
import { FindProgramsDto } from './dto/find-programs.dto.js';
import { CreateProgramRuleDto } from './dto/create-program-rule.dto.js';
import { CreateProgramWithRuleDto } from './dto/create-program-with-rule.dto.js';

@ApiTags('Programs')
@ApiBearerAuth('access-token')
@Controller('programs')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a program' })
  create(@TenantId() tenantId: string, @Body() dto: CreateProgramDto) {
    return this.programsService.createProgram(tenantId, dto);
  }

  @Post('with-rule')
  @ApiOperation({ summary: 'Create a program together with its primary eligibility rule in one call' })
  createWithRule(@TenantId() tenantId: string, @Body() dto: CreateProgramWithRuleDto) {
    return this.programsService.createProgramWithRule(tenantId, dto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  @ApiOperation({ summary: 'List programs (optionally filtered by locationId or "none")' })
  findAll(@TenantId() tenantId: string, @Query() query: FindProgramsDto) {
    return this.programsService.findAll(tenantId, query);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.FINANCE_OFFICER)
  @ApiOperation({ summary: 'Get program with its rules' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.programsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update program details' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
  ) {
    return this.programsService.updateProgram(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a program' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.programsService.softDeleteProgram(tenantId, id);
  }

  @Post(':id/rules')
  @ApiOperation({ summary: 'Add an eligibility rule to a program' })
  addRule(
    @TenantId() tenantId: string,
    @Param('id') programId: string,
    @Body() dto: CreateProgramRuleDto,
  ) {
    return this.programsService.addRule(tenantId, programId, dto);
  }

  @Delete(':id/rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove (soft-delete) an eligibility rule' })
  removeRule(
    @TenantId() tenantId: string,
    @Param('id') programId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.programsService.removeRule(tenantId, programId, ruleId);
  }
}
