
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
        console.log('Adding floors column to restaurants...');
        await pool.query('ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS floors JSONB DEFAULT \'[]\'');
        console.log('Added floors column.');

        // Initialize default floors for existing restaurants
        console.log('Initializing default floor for existing restaurants...');
        await pool.query('UPDATE restaurants SET floors = \'[{"id": "floor-1", "name": "Main Floor"}]\' WHERE floors = \'[]\' OR floors IS NULL');

        // Also update existing layout elements to have floorId if they don't
        const res = await pool.query('SELECT id, layout FROM restaurants');
        for (const row of res.rows) {
            let layout = row.layout;
            if (Array.isArray(layout)) {
                let updated = false;
                layout = layout.map(el => {
                    if (!el.floorId) {
                        updated = true;
                        return { ...el, floorId: 'floor-1' };
                    }
                    return el;
                });
                if (updated) {
                    await pool.query('UPDATE restaurants SET layout = $1 WHERE id = $2', [JSON.stringify(layout), row.id]);
                }
            }
        }
        console.log('Finished initializing floors.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        pool.end();
    }
}

migrate();
