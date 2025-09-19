# TwinQuest Recovery Service

A standalone recovery service for TwinQuest simulations with cron job scheduling and PostgreSQL integration.

## 🚀 Features

- **Automated Recovery**: Automatically detects and recovers incomplete simulations
- **Cron Job Scheduling**: Configurable intervals for recovery checks and cleanup
- **PostgreSQL Integration**: Direct database access for simulation management
- **Error Handling**: Robust retry logic with exponential backoff
- **Logging**: Comprehensive logging with Winston
- **Health Monitoring**: Built-in health checks and monitoring

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Access to the TwinQuest database

## 🛠️ Installation

1. **Clone and navigate to the directory:**
   ```bash
   cd C:\Users\User\source\repos\twinquest-runner
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` with your database configuration:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/twinquest?schema=public"
   RECOVERY_INTERVAL_MINUTES=5
   CLEANUP_INTERVAL_HOURS=1
   BATCH_SIZE=10
   MAX_RETRIES=3
   LOG_LEVEL=info
   ```

4. **Generate Prisma client:**
   ```bash
   npx prisma generate
   ```

## 🚀 Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm run start
```

### Production with PM2 (Recommended)
```bash
npm install -g pm2
npm run build
pm2 start dist/main.js --name "twinquest-recovery"
pm2 save
pm2 startup
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `RECOVERY_INTERVAL_MINUTES` | Recovery check interval | 5 |
| `CLEANUP_INTERVAL_HOURS` | Cleanup interval | 1 |
| `BATCH_SIZE` | Batch size for processing | 10 |
| `MAX_RETRIES` | Maximum retry attempts | 3 |
| `LOG_LEVEL` | Logging level | info |

### Cron Jobs

The service runs the following cron jobs:

1. **Recovery Check**: Every 5 minutes (configurable)
   - Detects incomplete simulations
   - Resumes processing from where it left off
   - Updates simulation status

2. **Cleanup**: Every hour (configurable)
   - Removes old completed/failed queue jobs
   - Cleans up old recovery logs

3. **Health Check**: Every 2 minutes
   - Monitors database connectivity
   - Logs service health status

## 📊 Monitoring

### Logs
- **Console**: Real-time logs with colors
- **Files**: 
  - `logs/combined.log` - All logs
  - `logs/error.log` - Error logs only

### Health Status
The service provides health monitoring:
- Database connectivity
- Service status
- Recovery statistics

## 🔧 Architecture

```
twinquest-runner/
├── src/
│   ├── main.ts                 # Application entry point
│   └── services/
│       ├── database.service.ts # Database connection & operations
│       ├── recovery.service.ts # Core recovery logic
│       ├── cron.service.ts     # Cron job management
│       └── logger.service.ts   # Logging configuration
├── prisma/
│   └── schema.prisma          # Database schema
├── logs/                      # Log files
├── package.json
├── tsconfig.json
└── README.md
```

## 🔄 How It Works

1. **Service Startup**:
   - Connects to PostgreSQL database
   - Starts cron job scheduler
   - Performs initial recovery check

2. **Recovery Process**:
   - Finds simulations with `RUNNING` status older than 5 minutes
   - Checks which personas still need processing
   - Resumes processing from the last completed persona
   - Updates simulation status and progress

3. **Error Handling**:
   - Retry logic with exponential backoff
   - Graceful error handling
   - Detailed logging for debugging

4. **Cleanup**:
   - Removes old completed jobs
   - Maintains database performance
   - Prevents log file bloat

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Failed**:
   - Check `DATABASE_URL` in `.env`
   - Ensure PostgreSQL is running
   - Verify database credentials

2. **Service Won't Start**:
   - Check logs in `logs/error.log`
   - Verify all dependencies are installed
   - Check port availability

3. **Recovery Not Working**:
   - Check database connectivity
   - Verify simulation data exists
   - Review recovery logs

### Logs Location
- **Error logs**: `logs/error.log`
- **All logs**: `logs/combined.log`
- **Console**: Real-time output

## 🔒 Security

- Database credentials stored in environment variables
- No sensitive data in logs
- Secure database connections
- Error messages sanitized

## 📈 Performance

- **Batch Processing**: Configurable batch sizes
- **Connection Pooling**: Efficient database connections
- **Retry Logic**: Prevents resource exhaustion
- **Cleanup**: Regular maintenance tasks

## 🤝 Integration

This service works alongside the main TwinQuest application:
- **Shared Database**: Uses the same PostgreSQL database
- **Non-blocking**: Doesn't interfere with main app
- **Independent**: Can be stopped/started separately
- **Monitoring**: Provides recovery status to main app

## 📝 License

MIT License - see LICENSE file for details.
