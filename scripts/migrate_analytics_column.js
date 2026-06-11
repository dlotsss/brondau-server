import pool from '../db.js';

async function migrate() {
  try {
    console.log('Adding analytics column to restaurants table...');
    await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS analytics BOOLEAN DEFAULT TRUE');
    console.log('Successfully added analytics column.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    pool.end();
  }
}

migrate();
