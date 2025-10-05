import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from env.local file
config({ path: resolve(__dirname, '../../env.local') });
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

      // Initialize database connection with retry
      await this.initializeDatabase();

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

      // Start connection monitoring
      this.startConnectionMonitoring();

    } catch (error) {
      this.logger.error('❌ Failed to start recovery service:', error);
      process.exit(1);
    }
  }

  private async initializeDatabase(): Promise<void> {
    const maxAttempts = 5;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await this.databaseService.connect();
        this.logger.info('✅ Database connected successfully');
        return;
      } catch (error) {
        attempts++;
        this.logger.error(`Database connection attempt ${attempts}/${maxAttempts} failed:`, error);
        
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to connect to database after ${maxAttempts} attempts`);
        }
        
        this.logger.info(`Retrying database connection in 10 seconds...`);
        await this.delay(10000);
      }
    }
  }

  private startConnectionMonitoring(): void {
    // Check database connection every 5 seconds for very responsive recovery
    setInterval(async () => {
      try {
        const isHealthy = await this.databaseService.healthCheck();
        if (!isHealthy) {
          this.logger.warn('⚠️ Database health check failed, attempting to reconnect...');
          const reconnected = await this.databaseService.reconnect();
          if (reconnected) {
            this.logger.info('✅ Database reconnected successfully');
          } else {
            this.logger.error('❌ Failed to reconnect to database');
          }
        }
      } catch (error) {
        this.logger.error('❌ Error during connection monitoring:', error);
        // Try to reconnect on any error
        this.logger.warn('🔄 Attempting to reconnect due to monitoring error...');
        const reconnected = await this.databaseService.reconnect();
        if (reconnected) {
          this.logger.info('✅ Database reconnected after monitoring error');
        }
      }
    }, 5000); // 5 seconds for very responsive recovery
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
