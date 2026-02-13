import pool from '../db.js';

async function migrate() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        role VARCHAR(10) NOT NULL,
        restaurant_id VARCHAR(50),
        guest_phone VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

        console.log('✅ Table push_subscriptions created successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
