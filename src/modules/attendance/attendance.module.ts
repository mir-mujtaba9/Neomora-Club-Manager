import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

/**
 * AttendanceModule — staff-only attendance tracking.
 *
 * Provides:
 *   POST  /attendance        — mark single participant attendance
 *   POST  /attendance/bulk   — bulk-mark a full session roster
 *   GET   /attendance        — list / filter attendance records
 *   GET   /attendance/summary — present / absent counts + rate
 *
 * PrismaService is available globally via PrismaModule so no extra imports
 * are needed here.
 */
@Module({
	controllers: [AttendanceController],
	providers: [AttendanceService],
	exports: [AttendanceService],
})
export class AttendanceModule {}
