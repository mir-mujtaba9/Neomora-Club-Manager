import 'dotenv/config';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { I18nValidationExceptionFilter, I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global prefix
  app.setGlobalPrefix('api');

  // Enable versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Enable CORS
  app.enableCors();

  // Global validation pipe — Plan E. I18nValidationPipe extends the
  // standard ValidationPipe and wires nestjs-i18n's exception factory so
  // validator messages produced via `i18nValidationMessage` are translated
  // per request language.
  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filters.
  // Order matters in Nest: filters listed later run FIRST. We want the most
  // specific filters to attempt the catch first, falling back to the
  // catch-all. So: catch-all is listed first (runs last), then Prisma, then
  // generic HttpException, then the i18n validation filter (most specific,
  // runs first — it only catches I18nValidationException).
  // The catch-all logs the full stack to the server console and (in non-prod)
  // includes the error name/message in the response body so failing smoke
  // tests don't need server-log scraping.
  app.useGlobalFilters(
    new AllExceptionsFilter(),
    new PrismaExceptionFilter(),
    new HttpExceptionFilter(),
    new I18nValidationExceptionFilter({
      detailedErrors: false,
    }),
  );

  // Swagger documentation (Plan K F-37).
  //   - Bearer scheme (`access-token`) for staff JWT auth.
  //   - API-key scheme (`api-key`) for partner machine-to-machine auth.
  //   The class-validator CLI plugin in nest-cli.json auto-extracts DTO
  //   schemas; controllers add `@ApiTags / @ApiOperation / @ApiResponse`
  //   for human-readable grouping and descriptions.
  const config = new DocumentBuilder()
    .setTitle('Neomora Club Manager API')
    .setDescription(
      'Multi-tenant club management platform. ' +
      'Staff endpoints use Bearer JWT; partner / integration endpoints accept ' +
      'either a Bearer JWT OR an `x-api-key` header (issued via POST /api-keys).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      'api-key',
    )
    .addTag('Auth', 'Staff login, refresh, 2FA, password reset')
    .addTag('API Keys', 'Issue and revoke partner API keys (SUPER_ADMIN)')
    .addTag('Participants', 'Participant CRUD + status — F-35 partner read access')
    .addTag('Sessions', 'Sessions / programmes — F-35 partner read access')
    .addTag('Payments', 'Payment lifecycle — F-35 partner read access')
    .addTag('Locations', 'Locations — F-35 partner read access')
    .addTag('Audit', 'Tamper-evident audit chain verification')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api/v1`);
  console.log(`Swagger docs at: http://localhost:${port}/api/docs`);
}
bootstrap();
