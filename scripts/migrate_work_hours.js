
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'avnadmin',
    password: 'AVNS_QJEsuUI1dU6xaP3hUXE',
    host: 'brondau-brondau.i.aivencloud.com',
    port: 27752,
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('Adding work_starts column...');
        await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS work_starts TEXT');
        // Using TEXT for simplicity (e.g. "09:00"), could act as TIME.
        console.log('Added work_starts.');

        console.log('Adding work_ends column...');
        await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS work_ends TEXT');
        console.log('Added work_ends.');

        // Optional: Add dummy data for testing if columns are empty
        console.log('Updating existing restaurants with default work hours...');
        await pool.query(`
        UPDATE restaurants 
        SET work_starts = '10:00',
            work_ends = '23:00'
        WHERE work_starts IS NULL
    `);
        console.log('Updated default work hours.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        pool.end();
    }
}

migrate();
