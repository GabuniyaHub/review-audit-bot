import { Module } from '@nestjs/common';
import { readSettings, SETTINGS } from './config/settings.js';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health/health.controller.js';
@Module({controllers: [HealthController], providers: [
  {provide: SETTINGS, useFactory: () => readSettings()}, DatabaseService]})
export class AppModule {}
