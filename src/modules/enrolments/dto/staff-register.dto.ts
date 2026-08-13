import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Gender } from '@prisma/client';

/**
 * Staff-side "Register Student" form — single endpoint that:
 *   1. Finds or creates the participant (student).
 *   2. Finds or creates the guardian (family contact).
 *   3. Allocates a seat and creates the enrolment.
 *   4. Creates an invoice for the calculated fee.
 *   5. Optionally records a payment at registration time.
 *
 * Either `participantId` (existing student) OR the new-student fields
 * (firstNameEn, lastNameEn, dateOfBirth, gender) must be supplied.
 * When creating a new student, guardian fields are also required.
 */
export class StaffRegisterDto {
  // ─── Existing student ────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'ID of an existing participant. Supply this OR the new-student fields below.' })
  @IsUUID()
  @IsOptional()
  participantId?: string;

  // ─── New student (required when participantId is absent) ─────────────────

  @ApiPropertyOptional({ example: 'Ahmed' })
  @IsString()
  @IsOptional()
  firstNameEn?: string;

  @ApiPropertyOptional({ example: 'Al-Rashid' })
  @IsString()
  @IsOptional()
  lastNameEn?: string;

  @ApiPropertyOptional({ example: '2018-03-15', description: 'ISO 8601 date' })
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  // ─── Guardian / family (required for new students) ───────────────────────

  @ApiPropertyOptional({ example: 'Mohammed Al-Rashid' })
  @IsString()
  @IsOptional()
  guardianFullName?: string;

  @ApiPropertyOptional({ example: '+971509998877' })
  @IsString()
  @IsOptional()
  guardianPhone?: string;

  @ApiPropertyOptional({ example: 'm.alrashid@example.com' })
  @IsEmail()
  @IsOptional()
  guardianEmail?: string;

  @ApiPropertyOptional({ example: 'Father' })
  @IsString()
  @IsOptional()
  guardianRelationship?: string;

  /**
   * Primary home location for the new participant.
   * Defaults to `locationId` (the enrolment location) when omitted.
   */
  @ApiPropertyOptional({ description: 'Home location for the new participant (defaults to enrolment location)' })
  @IsUUID()
  @IsOptional()
  primaryLocationId?: string;

  // ─── Registration details ─────────────────────────────────────────────────

  @ApiProperty({ description: 'Location where this enrolment is created' })
  @IsUUID()
  @IsNotEmpty()
  locationId!: string;

  @ApiPropertyOptional({ description: 'Programme ID' })
  @IsUUID()
  @IsOptional()
  programId?: string;

  @ApiProperty({ description: 'Term (Session) ID' })
  @IsUUID()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({ description: 'Date the student starts (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  joinDate!: string;

  @ApiProperty({ description: 'Number of consecutive terms committed to (1–3)', minimum: 1, maximum: 3, default: 1 })
  @IsInt()
  @Min(1)
  @Max(3)
  @Type(() => Number)
  commitmentLength: number = 1;

  @ApiPropertyOptional({ description: 'Include academy kit fee' })
  @IsBoolean()
  @IsOptional()
  includeKit?: boolean;

  // ─── Payment at registration ──────────────────────────────────────────────

  @ApiPropertyOptional({
    description: 'Record a payment immediately at registration. When false (default) the invoice is left at PENDING.',
  })
  @IsBoolean()
  @IsOptional()
  recordPaymentNow?: boolean;

  @ApiPropertyOptional({
    description: 'Payment method — required when recordPaymentNow is true',
    enum: ['CASH', 'BANK_TRANSFER', 'MADA', 'ONLINE_CARD', 'SADAD'],
  })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'External reference / receipt number' })
  @IsString()
  @IsOptional()
  paymentReference?: string;
}
