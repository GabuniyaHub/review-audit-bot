import {BeforeApplicationShutdown,Inject,Injectable,Logger,OnApplicationBootstrap} from '@nestjs/common';
import {setTimeout as delay} from 'node:timers/promises';
import {Settings,SETTINGS} from '../config/settings.js';
import {DatabaseService} from '../database/database.service.js';
import {SchedulerService} from './scheduler.service.js';
@Injectable()
export class SchedulerWorker implements OnApplicationBootstrap,BeforeApplicationShutdown {
 private readonly abort=new AbortController();private task?:Promise<void>;private readonly logger=new Logger(SchedulerWorker.name);
 constructor(@Inject(SETTINGS)private readonly settings:Settings,@Inject(DatabaseService)private readonly database:DatabaseService,@Inject(SchedulerService)private readonly scheduler:SchedulerService){}
 async onApplicationBootstrap(){if(!this.settings.schedulerEnabled)return;if(!await this.database.ready())throw new Error('Scheduler requires a migrated database');this.task=this.work();}
 private async work(){while(!this.abort.signal.aborted){try{await this.scheduler.tick();}catch{this.logger.warn('Scheduler temporarily unavailable');}await delay(5000,undefined,{signal:this.abort.signal}).catch(()=>{});}}
 async beforeApplicationShutdown(){this.abort.abort();await this.task;}
}
