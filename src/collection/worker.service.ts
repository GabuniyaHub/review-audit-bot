import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { Settings, SETTINGS } from '../config/settings.js';
import { DatabaseService } from '../database/database.service.js';
import { CollectionService } from './collection.service.js';
@Injectable()
export class CollectionWorker implements OnApplicationBootstrap,BeforeApplicationShutdown {
  private readonly abort=new AbortController();private task?:Promise<void>;
  private readonly logger=new Logger(CollectionWorker.name);
  constructor(@Inject(SETTINGS) private readonly settings:Settings,@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(CollectionService) private readonly collection:CollectionService) {}
  async onApplicationBootstrap():Promise<void> {
    if(!this.settings.collectionEnabled)return;
    if(!await this.database.ready())throw new Error('Collection requires a migrated database');
    this.task=this.work();
  }
  private async work():Promise<void> {
    while(!this.abort.signal.aborted) {
      try {if(await this.collection.processNext(this.abort.signal))continue;}catch{this.logger.warn('Collection queue temporarily unavailable');}
      await delay(2000,undefined,{signal:this.abort.signal}).catch(()=>{});
    }
  }
  async beforeApplicationShutdown():Promise<void> {this.abort.abort();await this.task;}
}
