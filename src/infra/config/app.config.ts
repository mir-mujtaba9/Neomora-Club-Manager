import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'api',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  // Public URL of the guardian-facing web app. Used to build QR-code targets
  // (e.g. `${webBaseUrl}/register/${slug}`). Override per environment.
  webBaseUrl: process.env.WEB_BASE_URL || 'http://localhost:5173',
  // Plan D — controls the waitlist promotion/expiry cron. Off by default
  // so smoke tests and `npm run start` don't surprise-trigger side effects.
  // Set to `true` in dev/staging/prod environments where you want offers
  // to auto-expire and seats to auto-promote.
  waitlistProcessorEnabled:
    (process.env.WAITLIST_PROCESSOR_ENABLED || 'false').toLowerCase() === 'true',
  // Plan F — controls payment-reminder + webhook + session-auto-status crons.
  // Off by default for same reason as waitlistProcessorEnabled.
  paymentReminderEnabled:
    (process.env.PAYMENT_REMINDER_ENABLED || 'false').toLowerCase() === 'true',
  paymentWebhookProcessorEnabled:
    (process.env.PAYMENT_WEBHOOK_PROCESSOR_ENABLED || 'false').toLowerCase() === 'true',
  sessionAutoStatusEnabled:
    (process.env.SESSION_AUTO_STATUS_ENABLED || 'false').toLowerCase() === 'true',
}));
