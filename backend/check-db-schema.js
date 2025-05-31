const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function checkDbSchema() {
  console.log('[CHECK] Checking database schema...');
  
  // Open database connection
  const db = await open({
    filename: './sshfix.db',
    driver: sqlite3.Database
  });
  
  try {
    // Get list of all tables
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
    console.log('[CHECK] Tables in database:');
    tables.forEach(table => {
      console.log(`  - ${table.name}`);
    });
    
    // Check terminal history related tables
    if (tables.some(t => t.name === 'terminal_history')) {
      console.log('\n[CHECK] terminal_history table exists, showing schema:');
      const schema = await db.all(`PRAGMA table_info(terminal_history)`);
      schema.forEach(col => {
        console.log(`  - ${col.name} (${col.type})`);
      });
      
      // Count entries
      const count = await db.get(`SELECT COUNT(*) as count FROM terminal_history`);
      console.log(`\n[CHECK] terminal_history has ${count.count} entries`);
      
      // Show sample entries
      const samples = await db.all(`SELECT * FROM terminal_history LIMIT 3`);
      console.log('\n[CHECK] Sample entries:');
      samples.forEach(entry => {
        console.log(`  ID: ${entry.id}, Command: ${entry.command.substring(0, 30)}...`);
        console.log(`    Server ID: ${entry.server_id}, Session ID: ${entry.chat_session_id || 'NULL'}`);
      });
    } else {
      console.log('\n[CHECK] terminal_history table does not exist');
    }
    
    // Check if there's any other history table
    const historyTables = tables.filter(t => t.name.toLowerCase().includes('history'));
    if (historyTables.length > 0 && !historyTables.some(t => t.name === 'terminal_history')) {
      console.log('\n[CHECK] Found other history-related tables:');
      for (const table of historyTables) {
        console.log(`\n[CHECK] Table: ${table.name}`);
        const schema = await db.all(`PRAGMA table_info(${table.name})`);
        schema.forEach(col => {
          console.log(`  - ${col.name} (${col.type})`);
        });
        
        // Count entries
        const count = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
        console.log(`\n[CHECK] ${table.name} has ${count.count} entries`);
        
        // Show sample entries if any
        if (count.count > 0) {
          const samples = await db.all(`SELECT * FROM ${table.name} LIMIT 3`);
          console.log(`\n[CHECK] Sample entries from ${table.name}:`);
          samples.forEach(entry => {
            console.log(`  Entry: ${JSON.stringify(entry)}`);
          });
        }
      }
    }
    
  } catch (error) {
    console.error('[ERROR] Error checking schema:', error);
  } finally {
    await db.close();
  }
  
  console.log('\n[CHECK] Database schema check completed');
}

// Run the check
checkDbSchema().catch(console.error); 