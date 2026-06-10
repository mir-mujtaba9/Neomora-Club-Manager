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

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Club Manager API')
    .setDescription('The Neomora Club Manager API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api/v1`);
  console.log(`Swagger docs at: http://localhost:${port}/api/docs`);
}
bootstrap();
