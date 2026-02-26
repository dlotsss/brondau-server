import pool from '../db.js';

async function migrate() {
    try {
        await pool.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_email TEXT;
    `);
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_guest_email ON bookings (guest_email);
    `);

        console.log('✅ Column guest_email added to bookings');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
