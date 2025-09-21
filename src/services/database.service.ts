import { PrismaClient } from '@prisma/client';
import { LoggerService } from './logger.service';

export class DatabaseService {
  private prisma: PrismaClient;
  private logger: LoggerService;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // 5 seconds

  constructor() {
    this.logger = new LoggerService();
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.logger.info('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async reconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return false;
    }

    this.reconnectAttempts++;
    this.logger.warn(`Attempting to reconnect to database (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    try {
      // Close existing connection if any
      if (this.isConnected) {
        await this.prisma.$disconnect();
      }

      // Create new Prisma client
      this.prisma = new PrismaClient({
        log: ['error', 'warn'],
      });

      // Attempt to connect
      await this.prisma.$connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.logger.info('✅ Database reconnected successfully');
      return true;
    } catch (error) {
      this.isConnected = false;
      this.logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.logger.info(`Retrying in ${this.reconnectDelay}ms...`);
        await this.delay(this.reconnectDelay);
        return this.reconnect();
      }
      
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      this.logger.info('Database connection closed');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
      throw error;
    }
  }

  getClient(): PrismaClient {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return this.prisma;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.isConnected = true;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if we're still connected before attempting operation
        if (!this.isConnected) {
          this.logger.warn('Database not connected, attempting to reconnect...');
          const reconnected = await this.reconnect();
          if (!reconnected) {
            throw new Error('Failed to reconnect to database');
          }
        }

        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a connection error
        if (this.isConnectionError(error)) {
          this.logger.warn(`Database connection lost on attempt ${attempt}, attempting to reconnect...`);
          this.isConnected = false;
          const reconnected = await this.reconnect();
          if (!reconnected) {
            this.logger.error('Failed to reconnect to database');
            throw new Error('Database connection lost and reconnection failed');
          }
          // Continue to next attempt after successful reconnection
          continue;
        }
        
        if (attempt === maxRetries) {
          this.logger.error(`Operation failed after ${maxRetries} attempts:`, lastError);
          throw lastError;
        }

        this.logger.warn(`Operation attempt ${attempt} failed, retrying in ${delayMs}ms:`, error);
        await this.delay(delayMs * attempt); // Exponential backoff
      }
    }

    throw lastError!;
  }

  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    const errorKind = error.kind || '';
    
    return (
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('closed') ||
      errorKind === 'Closed' || // PostgreSQL connection closed
      errorCode === 'P1001' || // Prisma connection error
      errorCode === 'P1002' || // Prisma connection timeout
      errorCode === 'P1008' || // Prisma operation timeout
      errorCode === 'P1017' || // Prisma server closed connection
      errorCode === 'P2024'    // Prisma connection timeout
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
