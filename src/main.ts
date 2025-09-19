import 'dotenv/config';
import { RecoveryService } from './services/recovery.service';
import { CronService } from './services/cron.service';
import { DatabaseService } from './services/database.service';
import { LoggerService } from './services/logger.service';

class RecoveryApplication {
  private recoveryService: RecoveryService;
  private cronService: CronService;
  private databaseService: DatabaseService;
  private logger: LoggerService;

  constructor() {
    this.logger = new LoggerService();
    this.databaseService = new DatabaseService();
    this.recoveryService = new RecoveryService(this.databaseService, this.logger);
    this.cronService = new CronService(this.recoveryService, this.logger);
  }

  async start() {
    try {
      this.logger.info('🚀 Starting TwinQuest Recovery Service...');

      // Initialize database connection
      await this.databaseService.connect();
      this.logger.info('✅ Database connected successfully');

      // Start cron jobs
      await this.cronService.start();
      this.logger.info('✅ Cron jobs started successfully');

      // Perform initial recovery check
      await this.recoveryService.checkAndRecoverIncompleteSimulations();

      this.logger.info('🎉 TwinQuest Recovery Service is running!');
      this.logger.info('📊 Service Status: ACTIVE');
      this.logger.info('🔌 Recovery Service running on port 3001');

      // Keep the process alive
      process.on('SIGINT', this.gracefulShutdown.bind(this));
      process.on('SIGTERM', this.gracefulShutdown.bind(this));

    } catch (error) {
      this.logger.error('❌ Failed to start recovery service:', error);
      process.exit(1);
    }
  }

  private async gracefulShutdown() {
    this.logger.info('🛑 Shutting down recovery service...');
    
    try {
      await this.cronService.stop();
      await this.databaseService.disconnect();
      this.logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      this.logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the application
const app = new RecoveryApplication();
app.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
