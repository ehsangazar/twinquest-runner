require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');

async function checkOptionColumns() {
  const prisma = new PrismaClient();
  try {
    console.log('🔍 Checking Option table columns...');
    await prisma.$connect();

    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Option' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    console.log('📋 Option table columns:');
    columns.forEach(col => console.log(`  - ${col.column_name} (${col.data_type})`));

  } catch (error) {
    console.error('❌ Error checking columns:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkOptionColumns();
