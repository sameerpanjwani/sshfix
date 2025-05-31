const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function fixHistoryTable() {
  console.log('[FIX] Starting history table fixes...');
  
  // Open database connection
  const db = await open({
    filename: './sshfix.db',
    driver: sqlite3.Database
  });
  
  try {
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // Find duplicate entries (same command, output, and server_id)
    const duplicates = await db.all(`
      SELECT command, output, server_id, COUNT(*) as count
      FROM history
      GROUP BY command, output, server_id
      HAVING count > 1
    `);
    
    console.log(`[FIX] Found ${duplicates.length} sets of duplicate entries`);
    
    // Handle duplicates
    if (duplicates.length > 0) {
      // Create a temporary table to store entries we want to keep
      await db.run(`
        CREATE TEMPORARY TABLE history_temp AS
        SELECT id, server_id, command, output, created_at, chat_session_id
        FROM history
        WHERE 1=0
      `);
      
      // For each set of duplicates, keep only the newest entry
      for (const dup of duplicates) {
        // Get all instances of this duplicate set
        const instances = await db.all(`
          SELECT id, server_id, command, output, created_at, chat_session_id
          FROM history
          WHERE command = ? AND output = ? AND server_id = ?
          ORDER BY id DESC
        `, [dup.command, dup.output, dup.server_id]);
        
        // Keep only the newest one
        if (instances.length > 0) {
          const newest = instances[0];
          await db.run(`
            INSERT INTO history_temp (id, server_id, command, output, created_at, chat_session_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [newest.id, newest.server_id, newest.command, newest.output, newest.created_at, newest.chat_session_id]);
          
          console.log(`[FIX] Kept newest entry for command: ${newest.command.substring(0, 30)}...`);
        }
      }
      
      // Delete duplicate entries from original table
      for (const dup of duplicates) {
        // Delete all but keep newest (which we've saved in the temp table)
        await db.run(`
          DELETE FROM history
          WHERE command = ? AND output = ? AND server_id = ?
          AND id NOT IN (
            SELECT id FROM history_temp 
            WHERE command = ? AND output = ? AND server_id = ?
          )
        `, [dup.command, dup.output, dup.server_id, dup.command, dup.output, dup.server_id]);
      }
      
      // Drop the temporary table
      await db.run(`DROP TABLE history_temp`);
    }
    
    // Ensure each entry has a session ID (use server_id as fallback)
    const nullSessionEntries = await db.get(`
      SELECT COUNT(*) as count
      FROM history
      WHERE chat_session_id IS NULL
    `);
    
    if (nullSessionEntries.count > 0) {
      console.log(`[FIX] Setting default session ID for ${nullSessionEntries.count} entries without session ID`);
      
      // Update entries with NULL session ID to use a server-specific default
      await db.run(`
        UPDATE history
        SET chat_session_id = 'server-' || server_id || '-session-default'
        WHERE chat_session_id IS NULL
      `);
    }
    
    // Add index on chat_session_id if it doesn't exist
    try {
      await db.run(`
        CREATE INDEX IF NOT EXISTS idx_history_session_id
        ON history(chat_session_id)
      `);
      console.log('[FIX] Created index on chat_session_id column');
    } catch (error) {
      console.error('[ERROR] Failed to create index:', error);
    }
    
    // Commit all changes
    await db.run('COMMIT');
    
    // Verify fixes
    const finalCount = await db.get(`SELECT COUNT(*) as count FROM history`);
    console.log(`[FIX] Final history entry count: ${finalCount.count}`);
    
    // Check for any remaining duplicates
    const remainingDuplicates = await db.all(`
      SELECT command, output, server_id, COUNT(*) as count
      FROM history
      GROUP BY command, output, server_id
      HAVING count > 1
    `);
    
    if (remainingDuplicates.length > 0) {
      console.error(`[WARNING] There are still ${remainingDuplicates.length} sets of duplicates`);
    } else {
      console.log('[SUCCESS] No duplicate entries remain in history table');
    }
    
  } catch (error) {
    // Rollback in case of error
    console.error('[ERROR] Error during fix process:', error);
    await db.run('ROLLBACK');
  } finally {
    // Close database connection
    await db.close();
  }
  
  console.log('[FIX] History table fixes completed');
}

// Run the fix
fixHistoryTable().catch(console.error); 