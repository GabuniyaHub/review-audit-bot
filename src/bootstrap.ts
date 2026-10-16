import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './common/http-exception.filter.js';
export async function createApplication() {
  const app = await NestFactory.create(AppModule, {abortOnError: false});
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  return app;
}
