import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator.js';
import { RegistrationService } from './registration.service.js';
import { FormRegistrationDto } from './dto/form-registration.dto.js';
 
/**
 * Public-facing registration routes.
 *
 * All routes are @Public() — no JWT required.
 * The location context is carried in the URL slug (e.g. /register/elite-riyadh).
 *
 * GET  /register/:slug        → fetch form config (location info + open sessions)
 * POST /register/:slug        → submit the registration form
 */
@Controller('register')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}
 
  /**
   * Returns the location metadata and list of open sessions so the
   * frontend can render the form with a populated session picker.
   *
   * Example response:
   * {
   *   location: { id, name, city, ... },
   *   tenant:   { id, name, slug },
   *   sessions: [{ id, name, startDate, endDate, fee, paymentPlans }],
   *   hasOpenSessions: true
   * }
   */
  @Public()
  @Get(':slug')
  async getFormConfig(@Param('slug') slug: string) {
    return this.registrationService.getFormConfig(slug);
  }
 
  /**
   * Submits the registration form.
   *
   * - sessionId is optional.  When provided the participant is enrolled
   *   (or waitlisted if the session is full).
   * - When sessionId is omitted the participant is created at INQUIRY status
   *   with no enrolment — staff follow up later.
   *
   * Example response (enrolled):
   * {
   *   success: true,
   *   participantId: "uuid",
   *   uniqueId: "P-00042",
   *   enrolmentStatus: "ENROLLED",   // "WAITLISTED" | "NONE"
   *   enrolmentId: "uuid",
   *   message: "..."
   * }
   */
  @Public()
  @Post(':slug')
  async submitForm(
    @Param('slug') slug: string,
    @Body() dto: FormRegistrationDto,
  ) {
    return this.registrationService.submitForm(slug, dto);
  }
}