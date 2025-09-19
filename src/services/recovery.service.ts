import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';

export interface RecoveryResult {
  recovered: number;
  failed: number;
  total: number;
  status: 'HEALTHY' | 'UNHEALTHY' | 'WARNING';
  issues: string[];
  recommendations: string[];
}

export class RecoveryService {
  private database: DatabaseService;
  private logger: LoggerService;
  private batchSize: number;
  private maxRetries: number;

  constructor(database: DatabaseService, logger: LoggerService) {
    this.database = database;
    this.logger = logger;
    this.batchSize = parseInt(process.env.BATCH_SIZE || '10');
    this.maxRetries = parseInt(process.env.MAX_RETRIES || '3');
  }

  async processQueueJobs(): Promise<void> {
    this.logger.info('🔄 Processing queue jobs...');

    try {
      const prisma = this.database.getClient();

      // Get next job to process
      const nextJob = await this.database.executeWithRetry(async () => {
        return await prisma.$queryRaw<Array<{
          id: number;
          job_id: string;
          survey_id: number;
          user_id: number;
          persona_count: number;
          selected_persona_ids: number[];
          is_random_selection: boolean;
          status: string;
          progress_percentage: number;
          priority: number;
          created_at: Date;
          started_at?: Date;
          completed_at?: Date;
          failed_at?: Date;
          retry_count: number;
          max_retries: number;
          error_message?: string;
          metadata: any;
        }>>`
          SELECT 
            id,
            job_id,
            survey_id,
            user_id,
            persona_count,
            selected_persona_ids,
            is_random_selection,
            status,
            progress_percentage,
            priority,
            created_at,
            started_at,
            completed_at,
            failed_at,
            retry_count,
            max_retries,
            error_message,
            metadata
          FROM simulation_queue_jobs
          WHERE status = 'PENDING'
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
        `;
      });

      if (!nextJob || nextJob.length === 0) {
        this.logger.info('📭 No pending jobs in queue');
        return;
      }

      const job = nextJob[0];
      this.logger.info(`🎯 Processing job ${job.job_id} for survey ${job.survey_id}`);

      // Mark as processing
      await this.database.executeWithRetry(async () => {
        await prisma.$executeRaw`
          UPDATE simulation_queue_jobs
          SET "status" = 'PROCESSING', "started_at" = NOW()
          WHERE "id" = ${job.id}
        `;
      });

      // Update simulation status to RUNNING
      await this.database.executeWithRetry(async () => {
        await prisma.$executeRaw`
          UPDATE simulations
          SET "status" = 'RUNNING'::"SimulationStatus", "updatedAt" = NOW()
          WHERE "queue_job_id" = ${job.job_id}
        `;
      });

      // Process the simulation (simplified version)
      await this.processSimulationJob(job);

      // Mark as completed
      await this.database.executeWithRetry(async () => {
        await prisma.$executeRaw`
          UPDATE simulation_queue_jobs
          SET "status" = 'COMPLETED', "completed_at" = NOW(), "progress_percentage" = 100
          WHERE "id" = ${job.id}
        `;
      });

      // Update simulation status to COMPLETED
      await this.database.executeWithRetry(async () => {
        await prisma.$executeRaw`
          UPDATE simulations
          SET "status" = 'COMPLETED'::"SimulationStatus", "updatedAt" = NOW(), "progress_percentage" = 100
          WHERE "queue_job_id" = ${job.job_id}
        `;
      });

      this.logger.info(`✅ Job ${job.job_id} completed successfully`);

    } catch (error) {
      this.logger.error('❌ Error processing queue jobs:', error);
    }
  }

  private async processSimulationJob(job: any): Promise<void> {
    this.logger.info(`🚀 Processing simulation for survey ${job.survey_id} with ${job.persona_count} personas`);
    
    // This is a simplified simulation processing
    // In a real implementation, you would:
    // 1. Get survey questions
    // 2. Generate responses for each persona
    // 3. Save responses to database
    // 4. Update progress
    
    // For now, just simulate some work
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.logger.info(`✅ Simulation processing completed for survey ${job.survey_id}`);
  }

  async checkAndRecoverFailedSimulations(): Promise<RecoveryResult> {
    this.logger.info('🔍 Checking for failed simulations to recover...');

    let recovered = 0;
    let failed = 0;
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const prisma = this.database.getClient();

      // Find failed simulations that can be retried
      const failedSimulations = await this.database.executeWithRetry(async () => {
        return await prisma.$queryRaw<Array<{
          id: number;
          simulationId: string;
          surveyId: number;
          status: string;
          retry_count: number;
          max_retries: number;
          error_message: string;
          queue_job_id: string;
        }>>`
          SELECT 
            s.id,
            s."simulationId",
            s."surveyId",
            s."status",
            s."retry_count",
            s."queue_job_id",
            qj."retry_count" as job_retry_count,
            qj."max_retries",
            qj."error_message"
          FROM simulations s
          LEFT JOIN simulation_queue_jobs qj ON s."queue_job_id" = qj."job_id"
          WHERE s."status" = 'FAILED'
          AND (qj."retry_count" < qj."max_retries" OR qj."retry_count" IS NULL)
          AND s."createdAt" > NOW() - INTERVAL '24 hours'
        `;
      });

      if (failedSimulations.length === 0) {
        this.logger.info('✅ No failed simulations found that can be recovered');
        return {
          recovered: 0,
          failed: 0,
          total: 0,
          status: 'HEALTHY',
          issues: [],
          recommendations: []
        };
      }

      this.logger.info(`Found ${failedSimulations.length} failed simulations to recover`);

      for (const simulation of failedSimulations) {
        try {
          // Reset simulation status to PENDING
          await this.database.executeWithRetry(async () => {
            await prisma.$executeRaw`
              UPDATE simulations
              SET "status" = 'PENDING'::"SimulationStatus", "updatedAt" = NOW(), "error_message" = NULL
              WHERE "id" = ${simulation.id}
            `;
          });

          // Reset queue job status to PENDING if it exists
          if (simulation.queue_job_id) {
            await this.database.executeWithRetry(async () => {
              await prisma.$executeRaw`
                UPDATE simulation_queue_jobs
                SET "status" = 'PENDING', "retry_count" = 0, "error_message" = NULL, "failed_at" = NULL
                WHERE "job_id" = ${simulation.queue_job_id}
              `;
            });
          }

          recovered++;
          this.logger.info(`✅ Recovered simulation ${simulation.simulationId}`);

        } catch (error) {
          failed++;
          this.logger.error(`❌ Failed to recover simulation ${simulation.simulationId}:`, error);
        }
      }

      return {
        recovered,
        failed,
        total: failedSimulations.length,
        status: failed > 0 ? 'WARNING' : 'HEALTHY',
        issues: failed > 0 ? [`Failed to recover ${failed} simulations`] : [],
        recommendations: failed > 0 ? ['Check logs for specific error details'] : []
      };

    } catch (error) {
      this.logger.error('❌ Error during failed simulation recovery:', error);
      return {
        recovered: 0,
        failed: 1,
        total: 1,
        status: 'UNHEALTHY',
        issues: ['Recovery process failed'],
        recommendations: ['Check database connection and logs']
      };
    }
  }

  async checkAndRecoverStuckSimulations(): Promise<RecoveryResult> {
    this.logger.info('🔍 Checking for stuck simulations...');

    let recovered = 0;
    let failed = 0;
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const prisma = this.database.getClient();

      // Find simulations that are stuck in RUNNING status
      const stuckSimulations = await this.database.executeWithRetry(async () => {
        return await prisma.$queryRaw<Array<{
          id: number;
          simulationId: string;
          surveyId: number;
          status: string;
          updatedAt: Date;
          queue_job_id: string;
        }>>`
          SELECT 
            s.id,
            s."simulationId",
            s."surveyId",
            s."status",
            s."updatedAt",
            s."queue_job_id"
          FROM simulations s
          WHERE s."status" = 'RUNNING'
          AND s."updatedAt" < NOW() - INTERVAL '10 minutes'
        `;
      });

      if (stuckSimulations.length === 0) {
        this.logger.info('✅ No stuck simulations found');
        return {
          recovered: 0,
          failed: 0,
          total: 0,
          status: 'HEALTHY',
          issues: [],
          recommendations: []
        };
      }

      this.logger.info(`Found ${stuckSimulations.length} stuck simulations`);

      for (const simulation of stuckSimulations) {
        try {
          // Reset simulation status to PENDING for retry
          await this.database.executeWithRetry(async () => {
            await prisma.$executeRaw`
              UPDATE simulations
              SET "status" = 'PENDING'::"SimulationStatus", "updatedAt" = NOW(), "error_message" = 'Recovered from stuck state'
              WHERE "id" = ${simulation.id}
            `;
          });

          // Reset queue job status to PENDING if it exists
          if (simulation.queue_job_id) {
            await this.database.executeWithRetry(async () => {
              await prisma.$executeRaw`
                UPDATE simulation_queue_jobs
                SET "status" = 'PENDING', "retry_count" = 0, "error_message" = 'Recovered from stuck state', "failed_at" = NULL
                WHERE "job_id" = ${simulation.queue_job_id}
              `;
            });
          }

          recovered++;
          this.logger.info(`✅ Recovered stuck simulation ${simulation.simulationId}`);

        } catch (error) {
          failed++;
          this.logger.error(`❌ Failed to recover stuck simulation ${simulation.simulationId}:`, error);
        }
      }

      return {
        recovered,
        failed,
        total: stuckSimulations.length,
        status: failed > 0 ? 'WARNING' : 'HEALTHY',
        issues: failed > 0 ? [`Failed to recover ${failed} stuck simulations`] : [],
        recommendations: failed > 0 ? ['Check logs for specific error details'] : []
      };

    } catch (error) {
      this.logger.error('❌ Error during stuck simulation recovery:', error);
      return {
        recovered: 0,
        failed: 1,
        total: 1,
        status: 'UNHEALTHY',
        issues: ['Stuck simulation recovery process failed'],
        recommendations: ['Check database connection and logs']
      };
    }
  }

  async checkAndRecoverIncompleteSimulations(): Promise<RecoveryResult> {
    this.logger.info('🔍 Starting simulation recovery process...');

    // Add initial delay to prevent immediate retries
    await this.delay(5000); // 5 second delay

    let recovered = 0;
    let failed = 0;
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const prisma = this.database.getClient();

      // Find simulations that are in RUNNING status but might be incomplete
      const incompleteSimulations = await this.database.executeWithRetry(async () => {
        return await prisma.simulations.findMany({
          where: {
            status: 'RUNNING',
            createdAt: {
              lt: new Date(Date.now() - 5 * 60 * 1000), // Older than 5 minutes
            },
          },
        });
      });

      this.logger.info(`Found ${incompleteSimulations.length} potentially incomplete simulations`);

      for (const simulation of incompleteSimulations) {
        try {
          await this.resumeIncompleteSimulation(simulation);
          recovered++;
          
          // Add delay between recovery attempts to prevent overwhelming the system
          await this.delay(2000); // 2 second delay
        } catch (error) {
          this.logger.error(`Failed to recover simulation ${simulation.simulationId}:`, error);
          failed++;
          issues.push(`Simulation ${simulation.simulationId} failed to recover: ${error instanceof Error ? error.message : 'Unknown error'}`);
          
          // Add delay even for failed attempts
          await this.delay(1000); // 1 second delay
        }
      }

      // Check for stuck queue jobs
      await this.recoverStuckQueueJobs();

      // Determine overall status
      let status: 'HEALTHY' | 'UNHEALTHY' | 'WARNING' = 'HEALTHY';
      
      if (failed > 0) {
        status = failed > recovered ? 'UNHEALTHY' : 'WARNING';
        recommendations.push('Check simulation logs and manually retry failed simulations');
      }

      if (incompleteSimulations.length === 0) {
        this.logger.info('✅ No incomplete simulations found');
      } else {
        this.logger.info(`✅ Recovery completed: ${recovered} recovered, ${failed} failed`);
      }

      const result: RecoveryResult = {
        recovered,
        failed,
        total: incompleteSimulations.length,
        status,
        issues,
        recommendations
      };

      this.logger.info('📊 Recovery Summary:', result);
      return result;

    } catch (error) {
      this.logger.error('❌ Recovery process failed:', error);
      return {
        recovered: 0,
        failed: 1,
        total: 1,
        status: 'UNHEALTHY',
        issues: [`Recovery process failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        recommendations: ['Check database connection and service logs']
      };
    }
  }

  private async resumeIncompleteSimulation(simulation: any): Promise<void> {
    const simulationId = simulation.simulationId;
    this.logger.info(`Attempting to resume incomplete simulation: ${simulationId}`);

    const prisma = this.database.getClient();

    try {
        // Get questions using the correct table name (Question capitalized)
        const questions = await this.database.executeWithRetry(async () => {
          return await prisma.question.findMany({
            where: { surveyId: simulation.surveyId },
            include: { Option: true },
            orderBy: { order: 'asc' },
          });
      });

      // Get completed persona IDs
      const completedPersonaIds = await this.getCompletedPersonaIds(simulationId);
      const allSelectedPersonaIds = simulation.selected_persona_ids;

      const remainingPersonaIds = allSelectedPersonaIds.filter(
        (id: number) => !completedPersonaIds.includes(id),
      );

      if (remainingPersonaIds.length === 0) {
        this.logger.info(`Simulation ${simulationId} has no remaining personas to process. Marking as COMPLETED.`);
        
        await this.database.executeWithRetry(async () => {
          return await prisma.simulations.update({
            where: { simulationId },
            data: {
              status: 'COMPLETED',
              progress_percentage: 100,
              updatedAt: new Date(),
              recovery_status: 'COMPLETED',
            },
          });
        });
        return;
      }

      this.logger.info(`Found ${remainingPersonaIds.length} remaining personas for simulation ${simulationId}`);

      // Get remaining personas data
      const remainingPersonasData = await this.database.executeWithRetry(async () => {
        return await prisma.personas.findMany({
          where: { id: { in: remainingPersonaIds } },
        });
      });

      // Update simulation status to IN_PROGRESS for recovery
      await this.database.executeWithRetry(async () => {
        return await prisma.simulations.update({
          where: { simulationId },
          data: {
            recovery_status: 'IN_PROGRESS',
            resumed_at: new Date(),
          },
        });
      });

      // Process remaining personas in batches
      await this.processRemainingPersonas(
        simulation.surveyId,
        simulationId,
        questions,
        remainingPersonasData,
      );

      // Mark as completed
      await this.database.executeWithRetry(async () => {
        return await prisma.simulations.update({
          where: { simulationId },
          data: {
            recovery_status: 'COMPLETED',
            resumed_at: new Date(),
          },
        });
      });

      this.logger.info(`✅ Successfully resumed simulation ${simulationId}`);

    } catch (error) {
      this.logger.error(`❌ Failed to resume simulation ${simulationId}:`, error);
      
      // Mark simulation as failed
      await this.database.executeWithRetry(async () => {
        return await prisma.simulations.update({
          where: { simulationId },
          data: {
            status: 'FAILED',
            recovery_status: 'FAILED',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      });
      
      throw error;
    }
  }

  private async processRemainingPersonas(
    surveyId: number,
    simulationId: string,
    questions: any[],
    personas: any[],
  ): Promise<void> {
    const batches = this.chunkArray(personas, this.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.info(`Processing batch ${i + 1}/${batches.length} for simulation ${simulationId}`);

      // Process batch with retry logic
      await this.database.executeWithRetry(async () => {
        await Promise.all(
          batch.map(async (persona) => {
            try {
              // Generate responses for this persona
              const responses = await this.generatePersonaResponses(persona, questions);
              
              // Save responses
              await this.savePersonaResponses(surveyId, simulationId, persona.id, responses);
              
              // Update simulation counters
              await this.updateSimulationCounters(simulationId);
            } catch (error) {
              this.logger.error(`Failed to process persona ${persona.id}:`, error);
              throw error;
            }
          }),
        );
      }, this.maxRetries, 2000);

      // Small delay between batches
      await this.delay(1000);
    }
  }

  private async generatePersonaResponses(persona: any, questions: any[]): Promise<Array<{
    questionId: number;
    optionId: number | null;
    answer: string;
  }>> {
    const responses: Array<{
      questionId: number;
      optionId: number | null;
      answer: string;
    }> = [];

    for (const question of questions) {
      // For now, generate mock responses
      // In a real implementation, this would call the ChatGPT service
      const response = {
        questionId: question.id,
        optionId: question.Option?.[0]?.id || null,
        answer: `Mock response for persona ${persona.name}`,
      };
      responses.push(response);
    }

    return responses;
  }

  private async savePersonaResponses(
    surveyId: number,
    simulationId: string,
    personaId: number,
    responses: Array<{
      questionId: number;
      optionId: number | null;
      answer: string;
    }>,
  ): Promise<void> {
    const prisma = this.database.getClient();
    
    const responseData = responses.map((response) => ({
      surveyId,
      questionId: response.questionId,
      optionId: response.optionId,
      personaId,
      simulationId,
      answer: response.answer,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await this.database.executeWithRetry(async () => {
      return await prisma.survey_responses.createMany({
        data: responseData,
      });
    });
  }

  private async updateSimulationCounters(simulationId: string): Promise<void> {
    const prisma = this.database.getClient();

    const simulation = await this.database.executeWithRetry(async () => {
      return await prisma.simulations.findUnique({
        where: { simulationId },
      });
    });

    if (simulation) {
      const totalResponses = await this.database.executeWithRetry(async () => {
        return await prisma.survey_responses.count({
          where: { simulationId },
        });
      });

      const progressPercentage = Math.min(
        (totalResponses / (simulation.total_requests * simulation.selected_persona_count)) * 100,
        100,
      );

      await this.database.executeWithRetry(async () => {
        return await prisma.simulations.update({
          where: { simulationId },
          data: {
            successful_requests: totalResponses,
            progress_percentage: progressPercentage,
            updatedAt: new Date(),
          },
        });
      });
    }
  }

  private async getCompletedPersonaIds(simulationId: string): Promise<number[]> {
    const prisma = this.database.getClient();
    
    const responses = await this.database.executeWithRetry(async () => {
      return await prisma.survey_responses.findMany({
        where: { simulationId },
        select: { personaId: true },
        distinct: ['personaId'],
      });
    });

    return responses.map((r) => r.personaId);
  }

  private async recoverStuckQueueJobs(): Promise<void> {
    const prisma = this.database.getClient();
    
    try {
      // Find queue jobs that have been PROCESSING for too long
      const stuckJobs = await this.database.executeWithRetry(async () => {
        return await prisma.simulation_queue_jobs.findMany({
          where: {
            status: 'PROCESSING',
            started_at: {
              lt: new Date(Date.now() - 30 * 60 * 1000), // Older than 30 minutes
            },
          },
        });
      });

      if (stuckJobs.length > 0) {
        this.logger.info(`Found ${stuckJobs.length} stuck queue jobs, resetting to PENDING`);
        
        await this.database.executeWithRetry(async () => {
          return await prisma.simulation_queue_jobs.updateMany({
            where: {
              id: { in: stuckJobs.map(job => job.id) },
            },
            data: {
              status: 'PENDING',
              started_at: null,
              retry_count: { increment: 1 },
            },
          });
        });
      }
    } catch (error) {
      this.logger.error('Failed to recover stuck queue jobs:', error);
    }
  }

  async cleanupOldJobs(): Promise<void> {
    const prisma = this.database.getClient();
    
    try {
      // Clean up old completed/failed jobs (older than 7 days)
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const deletedJobs = await this.database.executeWithRetry(async () => {
        return await prisma.simulation_queue_jobs.deleteMany({
          where: {
            OR: [
              {
                status: 'COMPLETED',
                completed_at: { lt: cutoffDate },
              },
              {
                status: 'FAILED',
                failed_at: { lt: cutoffDate },
              },
            ],
          },
        });
      });

      this.logger.info(`🧹 Cleaned up ${deletedJobs.count} old queue jobs`);
    } catch (error) {
      this.logger.error('Failed to cleanup old jobs:', error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const isDbHealthy = await this.database.healthCheck();
      if (!isDbHealthy) {
        this.logger.warn('⚠️ Database health check failed');
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return false;
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
