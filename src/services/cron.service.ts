import * as cron from 'node-cron';
import { RecoveryService } from './recovery.service';
import { LoggerService } from './logger.service';

export class CronService {
  private recoveryService: RecoveryService;
  private logger: LoggerService;
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;

  constructor(recoveryService: RecoveryService, logger: LoggerService) {
    this.recoveryService = recoveryService;
    this.logger = logger;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Cron service is already running');
      return;
    }

    try {
      // Recovery check every 15 minutes (reduced frequency to prevent loops)
      const recoveryInterval = process.env.RECOVERY_INTERVAL_MINUTES || '15';
      const recoveryCron = `*/${recoveryInterval} * * * *`;
      
      const recoveryTask = cron.schedule(recoveryCron, async () => {
        this.logger.info('🔄 Running scheduled recovery check...');
        try {
          await this.recoveryService.checkAndRecoverIncompleteSimulations();
        } catch (error) {
          this.logger.error('❌ Scheduled recovery check failed:', error);
        }
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.tasks.set('recovery', recoveryTask);

      // Cleanup old jobs every hour
      const cleanupInterval = process.env.CLEANUP_INTERVAL_HOURS || '1';
      const cleanupCron = `0 */${cleanupInterval} * * *`;
      
      const cleanupTask = cron.schedule(cleanupCron, async () => {
        this.logger.info('🧹 Running scheduled cleanup...');
        try {
          await this.recoveryService.cleanupOldJobs();
        } catch (error) {
          this.logger.error('❌ Scheduled cleanup failed:', error);
        }
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.tasks.set('cleanup', cleanupTask);

      // Health check every 2 minutes
      const healthTask = cron.schedule('*/2 * * * *', async () => {
        try {
          await this.recoveryService.healthCheck();
        } catch (error) {
          this.logger.error('❌ Health check failed:', error);
        }
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.tasks.set('health', healthTask);

      // Failed simulation recovery every 30 minutes (reduced frequency)
      const failedRecoveryTask = cron.schedule('*/30 * * * *', async () => {
        this.logger.info('🔄 Running failed simulation recovery...');
        try {
          await this.recoveryService.checkAndRecoverFailedSimulations();
        } catch (error) {
          this.logger.error('❌ Failed simulation recovery failed:', error);
        }
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.tasks.set('failed-recovery', failedRecoveryTask);

      // Stuck simulation recovery every 20 minutes (reduced frequency)
      const stuckRecoveryTask = cron.schedule('*/20 * * * *', async () => {
        this.logger.info('🔄 Running stuck simulation recovery...');
        try {
          await this.recoveryService.checkAndRecoverStuckSimulations();
        } catch (error) {
          this.logger.error('❌ Stuck simulation recovery failed:', error);
        }
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.tasks.set('stuck-recovery', stuckRecoveryTask);

      // Start all tasks
      this.tasks.forEach((task, name) => {
        task.start();
        this.logger.info(`✅ Started cron task: ${name}`);
      });

      this.isRunning = true;
      this.logger.info('🎯 All cron tasks started successfully');

    } catch (error) {
      this.logger.error('❌ Failed to start cron service:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Cron service is not running');
      return;
    }

    try {
      this.tasks.forEach((task, name) => {
        task.stop();
        this.logger.info(`🛑 Stopped cron task: ${name}`);
      });

      this.tasks.clear();
      this.isRunning = false;
      this.logger.info('✅ All cron tasks stopped successfully');

    } catch (error) {
      this.logger.error('❌ Error stopping cron service:', error);
      throw error;
    }
  }

  getTaskStatus(): { [key: string]: boolean } {
    const status: { [key: string]: boolean } = {};
    this.tasks.forEach((task, name) => {
      status[name] = this.isRunning;
    });
    return status;
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }
}
