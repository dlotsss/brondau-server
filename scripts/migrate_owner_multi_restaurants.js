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
        console.log('Starting multi-restaurant owner migration...');

        // 1. Rename column and change type to JSONB
        // Step-by-step to be safe with data

        // a. Rename current column to old_id
        await pool.query('ALTER TABLE platform_owner RENAME COLUMN restaurant_id TO restaurant_id_old');

        // b. Add new JSONB column
        await pool.query('ALTER TABLE platform_owner ADD COLUMN restaurant_ids JSONB DEFAULT \'[]\'::jsonb');

        // c. Migrate data from old to new (as array)
        await pool.query(`
      UPDATE platform_owner 
      SET restaurant_ids = jsonb_build_array(restaurant_id_old) 
      WHERE restaurant_id_old IS NOT NULL
    `);

        // d. Drop old column
        await pool.query('ALTER TABLE platform_owner DROP COLUMN restaurant_id_old');

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
