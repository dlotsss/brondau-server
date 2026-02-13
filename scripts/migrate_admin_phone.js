import pool from '../db.js';

async function migrate() {
    try {
        await pool.query(`
      ALTER TABLE admins
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)
    `);
        console.log('✅ Column phone_number added to admins table');
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await pool.end();
    }
}

migrate();
