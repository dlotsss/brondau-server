import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes.js';
import pool from './db.js';

dotenv.config();

// Run startup migrations
async function runMigrations() {
  try {
    // Allow table_id and table_label to be NULL (for restaurants where with_map = false)
    await pool.query(`
      ALTER TABLE bookings
        ALTER COLUMN table_id DROP NOT NULL,
        ALTER COLUMN table_label DROP NOT NULL
    `);
    console.log('[migration] bookings.table_id and table_label are now nullable');
  } catch (e) {
    // Column may already be nullable - that's fine
    if (!e.message?.includes('does not exist')) {
      console.log('[migration] table_id/table_label already nullable or migration skipped:', e.message);
    }
  }

  try {
    // Add with_map column to restaurants if it doesn't exist
    await pool.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS with_map BOOLEAN DEFAULT true`);
    console.log('[migration] restaurants.with_map column ensured');
  } catch (e) {
    console.log('[migration] with_map column migration skipped:', e.message);
  }

  try {
    // Create guests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guests (
        phone TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        internal_comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[migration] guests table ensured');
  } catch (e) {
    console.log('[migration] guests table migration failed:', e.message);
  }

  try {
    // Add guest_comment to bookings
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_comment TEXT`);
    console.log('[migration] bookings.guest_comment column ensured');
  } catch (e) {
    console.log('[migration] bookings.guest_comment migration failed:', e.message);
  }

  try {
    // Create booking_tables for multiple tables support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_tables (
        id SERIAL PRIMARY KEY,
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        table_id TEXT NOT NULL,
        table_label TEXT,
        CONSTRAINT unique_booking_table UNIQUE (booking_id, table_id)
      )
    `);
    
    // Create index for fast layout checks
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_tables_table_id ON booking_tables(table_id)`);
    
    // Add cancellation fields to bookings
    await pool.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
      ADD COLUMN IF NOT EXISTS cancel_comment TEXT,
      ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancellation_token UUID DEFAULT gen_random_uuid()
    `);

    // Migration: Add booking duration fields
    await pool.query(`
      ALTER TABLE restaurants 
      ADD COLUMN IF NOT EXISTS booking_restriction INTEGER DEFAULT -1
    `);
    await pool.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT NULL
    `);

    console.log('Database initialized successfully');
  } catch (e) {
    console.log('[migration] bookings cancellation migration failed:', e.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

const PORT = process.env.PORT || 3001;
runMigrations().then(() => {
  app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
});
