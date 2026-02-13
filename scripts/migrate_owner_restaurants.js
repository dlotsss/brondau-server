import pg from 'pg';
const { Pool } = pg;

// Connection config from db.js
const pool = new Pool({
    user: 'avnadmin',
    password: 'AVNS_QJEsuUI1dU6xaP3hUXE',
    host: 'brondau-brondau.i.aivencloud.com',
    port: 27752,
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false
    }
});

async function migrate() {
    try {
        console.log('Starting owner migration...');

        // 1. Add restaurant_id column to platform_owner
        await pool.query(`
      ALTER TABLE platform_owner 
      ADD COLUMN IF NOT EXISTS restaurant_id TEXT;
    `);
        console.log('Added restaurant_id column.');

        // 2. Set default value 'all' for existing owners (developers)
        await pool.query(`
      UPDATE platform_owner 
      SET restaurant_id = 'all' 
      WHERE restaurant_id IS NULL;
    `);
        console.log('Set default restaurant_id to "all" for existing owners.');

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
