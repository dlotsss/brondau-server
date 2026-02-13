
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
        console.log('Adding photo_url column...');
        await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS photo_url TEXT');
        console.log('Added photo_url.');

        console.log('Adding address column...');
        await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address TEXT');
        console.log('Added address.');

        // Optional: Add dummy data for testing if columns are empty
        console.log('Updating existing restaurants with dummy data...');
        await pool.query(`
        UPDATE restaurants 
        SET photo_url = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=60',
            address = '123 Main St, New York, NY'
        WHERE photo_url IS NULL
    `);
        console.log('Updated dummy data.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        pool.end();
    }
}

migrate();
