const { PrismaClient } = require('@prisma/client');

async function checkTables() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Checking database tables...');
    
    // Get all table names
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    
    console.log('📋 Available tables:');
    tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });
    
    // Check if questions table exists with different cases
    const questionTables = tables.filter(t => 
      t.table_name.toLowerCase().includes('question')
    );
    
    if (questionTables.length > 0) {
      console.log('\n✅ Found question-related tables:');
      questionTables.forEach(table => {
        console.log(`  - ${table.table_name}`);
      });
    } else {
      console.log('\n❌ No question-related tables found');
    }
    
  } catch (error) {
    console.error('❌ Error checking tables:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTables();
