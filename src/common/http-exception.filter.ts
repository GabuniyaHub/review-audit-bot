import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    // Never log raw exceptions, URLs with query strings, headers or request bodies.
    if (status >= 500) this.logger.error(`HTTP failure: ${status}`);
    response.status(status).json({statusCode: status,
      error: status === 503 ? 'SERVICE_UNAVAILABLE' : status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_REJECTED',
      message: status === 503 ? 'Service is not ready' : status >= 500 ? 'Internal server error' : status === 404 ? 'Not found' : 'Request rejected',
      path: request.path, timestamp: new Date().toISOString()});
  }
}
