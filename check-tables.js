require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');

async function checkTables() {
  const prisma = new PrismaClient();
  try {
    console.log('🔍 Checking database tables...');
    await prisma.$connect();

    const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`;
    console.log('📋 Available tables:');
    tables.forEach(table => console.log(`  - ${table.tablename}`));

    const hasQuestionsTable = tables.some(table => table.tablename === 'questions');
    const hasQuestionTable = tables.some(table => table.tablename === 'question');
    const hasQuestionTableCapital = tables.some(table => table.tablename === 'Question');

    console.log('\n🔍 Question-related tables:');
    if (hasQuestionsTable) console.log('  ✅ questions (plural)');
    if (hasQuestionTable) console.log('  ✅ question (singular)');
    if (hasQuestionTableCapital) console.log('  ✅ Question (capital)');

    if (!hasQuestionsTable && !hasQuestionTable && !hasQuestionTableCapital) {
      console.log('  ❌ No question-related tables found');
    }

  } catch (error) {
    console.error('❌ Error checking tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables();