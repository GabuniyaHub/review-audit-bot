import { AnalysisService } from './analysis/analysis.service.js';
import { AnalysisWorker } from './analysis/worker.service.js';
import { ANALYZER, OpenRouterAnalyzer } from './analysis/client.js';
import { Module } from '@nestjs/common';
import { readSettings, SETTINGS } from './config/settings.js';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health/health.controller.js';
import { BotService } from './telegram/bot.service.js';
import { PollingService, telegramApiProvider } from './telegram/polling.service.js';
import { CollectionService } from './collection/collection.service.js';
import { CollectionWorker } from './collection/worker.service.js';
import { SourceCollector } from './collection/collector.js';
import { REVIEW_COLLECTOR } from './collection/types.js';
@Module({controllers: [HealthController], providers: [
  {provide: SETTINGS, useFactory: () => readSettings()}, DatabaseService, BotService, PollingService, telegramApiProvider,
    {provide:REVIEW_COLLECTOR,inject:[SETTINGS],useFactory:(settings:ReturnType<typeof readSettings>)=>new SourceCollector(settings)},CollectionService,CollectionWorker, {provide:ANALYZER,inject:[SETTINGS],useFactory:(settings:ReturnType<typeof readSettings>)=>new OpenRouterAnalyzer(settings)},AnalysisService,AnalysisWorker]})
export class AppModule {}
