import { Module } from '@nestjs/common';
import { readSettings, SETTINGS } from './config/settings.js';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health/health.controller.js';
import { BotService } from './telegram/bot.service.js';
import { PollingService, telegramApiProvider } from './telegram/polling.service.js';
@Module({controllers: [HealthController], providers: [
  {provide: SETTINGS, useFactory: () => readSettings()}, DatabaseService, BotService, PollingService, telegramApiProvider]})
export class AppModule {}
