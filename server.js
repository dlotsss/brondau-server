import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes.js';
import pool from './db.js';
import { handleUpdate, registerWebhook } from './telegram.js';

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
    // Delete invalid guests with empty phones (walk-in bug)
    await pool.query(`DELETE FROM guests WHERE phone = '' OR phone IS NULL`);
    console.log('[migration] cleaned up invalid guests');
  } catch (e) {
    console.log('[migration] clean up guests failed:', e.message);
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

    // Migration: Add age restriction message field
    await pool.query(`
      ALTER TABLE restaurants 
      ADD COLUMN IF NOT EXISTS age_restriction TEXT
    `);

    // Migration: Add deposit disclaimer field
    await pool.query(`
      ALTER TABLE restaurants 
      ADD COLUMN IF NOT EXISTS deposit TEXT,
      ADD COLUMN IF NOT EXISTS age_restriction_kz TEXT,
      ADD COLUMN IF NOT EXISTS deposit_kz TEXT
    `);

    // Migration: Add city field
    await pool.query(`
      ALTER TABLE restaurants 
      ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Алмата'
    `);
    
    
    // Set default city for existing restaurants
    await pool.query(`UPDATE restaurants SET city = 'Алмата' WHERE city IS NULL`);

    // Migration: Isolate guest db
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurant_guests (
        restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
        phone TEXT REFERENCES guests(phone) ON DELETE CASCADE,
        internal_comment TEXT,
        PRIMARY KEY (restaurant_id, phone)
      )
    `);

    // Migrate old comments to all restaurants they visited
    await pool.query(`
      INSERT INTO restaurant_guests (restaurant_id, phone, internal_comment)
      SELECT DISTINCT b.restaurant_id, g.phone, g.internal_comment
      FROM guests g
      JOIN bookings b ON g.phone = b.guest_phone
      WHERE g.internal_comment IS NOT NULL AND g.internal_comment != ''
      ON CONFLICT DO NOTHING
    `);

    console.log('Database initialized successfully');
  } catch (e) {
    console.log('[migration] bookings cancellation migration failed:', e.message);
  }

  try {
    // Add assigned_to column to bookings
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
    
    // Create staff_names table for autocomplete memory
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_names (
        id SERIAL PRIMARY KEY,
        restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        CONSTRAINT unique_staff_name UNIQUE (restaurant_id, name)
      )
    `);
    console.log('[migration] assigned_to and staff_names ensured');
  } catch (e) {
    console.log('[migration] assigned_to/staff_names migration failed:', e.message);
  }

  try {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT`);
    console.log('[migration] admins.telegram_chat_id ensured');
    
    // Admin works and booking deadlines
    await pool.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS admin_works JSONB`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMP`);
    console.log('[migration] admin_works and deadline_at ensured');
  } catch (e) {
    console.log('[migration] telegram_chat_id migration failed:', e.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

// Telegram webhook endpoint
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    await handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('[telegram] webhook handler error:', err);
    res.sendStatus(200); // Always return 200 to Telegram
  }
});

const PORT = process.env.PORT || 3001;
runMigrations().then(async () => {
  if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
  }

  // Register Telegram webhook
  const baseUrl = process.env.BACKEND_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.FRONTEND_URL || null));
  if (baseUrl && process.env.TELEGRAM_BOT_TOKEN) {
    await registerWebhook(baseUrl);
  }
}).catch(err => {
  console.error('Fatal migration error:', err);
});

export default app;
