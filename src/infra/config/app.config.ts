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
}));
