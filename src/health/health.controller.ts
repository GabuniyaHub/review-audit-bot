import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { PollingService } from '../telegram/polling.service.js';
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(PollingService) private readonly telegram?: PollingService) {}
  @Get('live') live() { return {status: 'ok'}; }
  @Get('ready') async ready() {
    if (!await this.database.ready() || this.telegram?.isReady() === false) throw new ServiceUnavailableException();
    return {status: 'ok', database: 'ready'};
  }
}
