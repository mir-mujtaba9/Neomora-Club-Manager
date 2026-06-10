import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Last-resort filter. Nest iterates global filters in reverse registration
 * order and picks the first one whose `@Catch(...)` metadata matches the
 * thrown exception. Because this filter is declared with a bare `@Catch()`
 * (matches everything) but is registered FIRST (so it runs LAST), it only
 * handles the "everything else" bucket — typically `PrismaClientUnknownRequestError`,
 * raw SQL errors, `TypeError`, etc.
 *
 * Logs the full error (with stack) to the server console and — while we are
 * debugging Plan A — surfaces the error name + message in the response body
 * so smoke tests can see what blew up without server-log scraping.
 *
 * Once Plan A is verified the `debug` block in the response should be removed
 * or gated to non-prod (already gated below).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const err = exception as Error & { code?: string; meta?: unknown };
    const name = err?.name ?? 'UnknownError';
    const message = err?.message ?? 'Unknown error';
    const code = err?.code;
    const meta = err?.meta;

    this.logger.error(
      `[AllExceptionsFilter] ${request.method} ${request.url} -> ${name}: ${message}`,
      err?.stack,
    );

    const isProd = process.env.NODE_ENV === 'production';

    response.status(status).json({
      success: false,
      statusCode: status,
      message: isProd ? 'Internal server error' : message,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(isProd
        ? {}
        : {
            debug: {
              name,
              ...(code ? { code } : {}),
              ...(meta ? { meta } : {}),
            },
          }),
    });
  }
}
