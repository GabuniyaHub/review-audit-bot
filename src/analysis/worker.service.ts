import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { Settings, SETTINGS } from '../config/settings.js';
import { DatabaseService } from '../database/database.service.js';
import { AnalysisService } from './analysis.service.js';
@Injectable()
export class AnalysisWorker implements OnApplicationBootstrap,BeforeApplicationShutdown {
  private readonly abort=new AbortController();private task?:Promise<void>;
  private readonly logger=new Logger(AnalysisWorker.name);
  constructor(@Inject(SETTINGS) private readonly settings:Settings,@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(AnalysisService) private readonly analysis:AnalysisService) {}
  async onApplicationBootstrap():Promise<void> {
    if(!this.settings.analysisEnabled)return;
    if(!await this.database.ready())throw new Error('Analysis requires a migrated database');
    this.task=this.work();
  }
  private async work():Promise<void> {
    while(!this.abort.signal.aborted) {
      try {if(await this.analysis.processNext(this.abort.signal))continue;}catch{this.logger.warn('Analysis queue temporarily unavailable');}
      await delay(2000,undefined,{signal:this.abort.signal}).catch(()=>{});
    }
  }
  async beforeApplicationShutdown():Promise<void> {this.abort.abort();await this.task;}
}
