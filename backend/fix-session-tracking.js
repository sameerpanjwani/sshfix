const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function fixSessionTracking() {
  console.log('[FIX] Starting session tracking fixes...');
  
  // Open database connection
  const db = await open({
    filename: './sshfix.db',
    driver: sqlite3.Database
  });
  
  try {
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // 1. Check if chat_session_id format is consistent
    const servers = await db.all(`SELECT id, name, host, chat_session_id FROM servers`);
    
    for (const server of servers) {
      console.log(`[INFO] Server ${server.id} (${server.name}): Session ID = ${server.chat_session_id || 'NULL'}`);
      
      // If server has a chat_session_id that ends with .0, fix it
      if (server.chat_session_id && server.chat_session_id.endsWith('.0')) {
        const fixedSessionId = server.chat_session_id.replace('.0', '');
        console.log(`[FIX] Fixing server ${server.id} session ID format: ${server.chat_session_id} -> ${fixedSessionId}`);
        
        await db.run(`
          UPDATE servers 
          SET chat_session_id = ? 
          WHERE id = ?
        `, [fixedSessionId, server.id]);
        
        // Also update history entries with this session ID
        await db.run(`
          UPDATE history 
          SET chat_session_id = ? 
          WHERE chat_session_id = ?
        `, [fixedSessionId, server.chat_session_id]);
        
        // Also update chat_history entries with this session ID
        await db.run(`
          UPDATE chat_history 
          SET chat_session_id = ? 
          WHERE chat_session_id = ?
        `, [fixedSessionId, server.chat_session_id]);
      }
    }
    
    // 2. Ensure history entries have proper session IDs that match the server
    // Get the current session ID for each server
    const updatedServers = await db.all(`SELECT id, chat_session_id FROM servers WHERE chat_session_id IS NOT NULL`);
    
    for (const server of updatedServers) {
      // Count history entries with matching session ID
      const matchingCount = await db.get(`
        SELECT COUNT(*) as count 
        FROM history 
        WHERE server_id = ? AND chat_session_id = ?
      `, [server.id, server.chat_session_id]);
      
      console.log(`[INFO] Server ${server.id} has ${matchingCount.count} history entries with matching session ID`);
      
      // Count entries with 'server-*-session-default' pattern
      const defaultCount = await db.get(`
        SELECT COUNT(*) as count 
        FROM history 
        WHERE server_id = ? AND chat_session_id LIKE 'server-%-session-default'
      `, [server.id]);
      
      if (defaultCount.count > 0) {
        console.log(`[FIX] Updating ${defaultCount.count} default session entries for server ${server.id}`);
        
        // Update entries with default session to use the current server session
        await db.run(`
          UPDATE history 
          SET chat_session_id = ? 
          WHERE server_id = ? AND chat_session_id LIKE 'server-%-session-default'
        `, [server.chat_session_id, server.id]);
      }
      
      // Count NULL session entries
      const nullCount = await db.get(`
        SELECT COUNT(*) as count 
        FROM history 
        WHERE server_id = ? AND chat_session_id IS NULL
      `, [server.id]);
      
      if (nullCount.count > 0) {
        console.log(`[FIX] Updating ${nullCount.count} NULL session entries for server ${server.id}`);
        
        // Update NULL session entries to use the current server session
        await db.run(`
          UPDATE history 
          SET chat_session_id = ? 
          WHERE server_id = ? AND chat_session_id IS NULL
        `, [server.chat_session_id, server.id]);
      }
    }
    
    // Commit all changes
    await db.run('COMMIT');
    
    // Verify fixes
    console.log('\n[VERIFY] Checking session tracking after fixes...');
    
    // Get servers with their session IDs
    const finalServers = await db.all(`SELECT id, name, chat_session_id FROM servers`);
    
    for (const server of finalServers) {
      if (server.chat_session_id) {
        // Count history entries with matching session ID
        const matchingCount = await db.get(`
          SELECT COUNT(*) as count 
          FROM history 
          WHERE server_id = ? AND chat_session_id = ?
        `, [server.id, server.chat_session_id]);
        
        // Count total history entries for this server
        const totalCount = await db.get(`
          SELECT COUNT(*) as count 
          FROM history 
          WHERE server_id = ?
        `, [server.id]);
        
        const percentage = totalCount.count > 0 
          ? Math.round((matchingCount.count / totalCount.count) * 100) 
          : 0;
        
        console.log(`[VERIFY] Server ${server.id} (${server.name}): ${matchingCount.count}/${totalCount.count} entries match session ID (${percentage}%)`);
      } else {
        console.log(`[VERIFY] Server ${server.id} (${server.name}): No session ID set`);
      }
    }
    
  } catch (error) {
    // Rollback in case of error
    console.error('[ERROR] Error during fix process:', error);
    await db.run('ROLLBACK');
  } finally {
    // Close database connection
    await db.close();
  }
  
  console.log('[FIX] Session tracking fixes completed');
}

// Run the fix
fixSessionTracking().catch(console.error); 