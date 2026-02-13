import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root (one level up from tests)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'brondau_db',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

const runTests = async () => {
    console.log('Starting Constraint Verification Tests...');
    let client;

    try {
        client = await pool.connect();

        // 1. Setup: Create Restaurant with specific hours
        const resName = `Test Rest ${Date.now()}`;
        const createRes = await client.query(
            'INSERT INTO restaurants (name, layout, work_starts, work_ends) VALUES ($1, $2, $3, $4) RETURNING id',
            [resName, '[]', '10:00', '22:00']
        );
        const restaurantId = createRes.rows[0].id;
        console.log(`Created restaurant ${restaurantId} with hours 10:00 - 22:00`);

        // Table
        const tableId = 'table-1';
        const guestPhone = '1234567890';

        const book = async (time, phone, expectedStatus, label) => {
            // Construct dateTime roughly for "Today" at given time
            // If time is 09:00, use today's date.
            const d = new Date();
            const [h, m] = time.split(':').map(Number);
            d.setHours(h, m, 0, 0);
            // If testing overnight logic, might need date adjustment, but for 10-22, today is fine.

            // Handle case where "Today" might be late night and 09:00 is technically "past"? 
            // Backend doesn't check "past" explicitly in the constraint logic I added (frontend does).
            // Backend checks work hours and overlaps.

            // Ensure we test with a future date to avoid any "past" logic if added later.
            d.setDate(d.getDate() + 1);

            // Adjust for timezone offset if needed? Backend expects ISO string probably? 
            // PostgreSQL client sends Date object as UTC or local? 
            // Let's send ISO string.
            // Actually the backend parses `new Date(dateTime)`.

            // To be safe and consistent with "Shift Logic", let's use a fixed date.
            // 2026-01-01.
            const fixedDate = new Date('2026-06-01T12:00:00Z'); // Future date
            fixedDate.setHours(h, m, 0, 0);

            const body = {
                tableId,
                tableLabel: 'T1',
                guestName: 'Test Guest',
                guestPhone: phone,
                guestCount: 2,
                dateTime: fixedDate.toISOString()
            };

            const res = await fetch(`http://localhost:3001/api/restaurants/${restaurantId}/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const status = res.status;
            const data = await res.json();

            if (status === expectedStatus) {
                console.log(`[PASS] ${label}: Got ${status}`);
            } else {
                console.error(`[FAIL] ${label}: Expected ${expectedStatus}, got ${status}. Error: ${data.error}`);
            }
        };

        // 2. Test: Booking too early (09:00) -> Should fail (400)
        await book('09:00', '111', 400, 'Booking before open (09:00)');

        // 3. Test: Booking too late (23:00) -> Should fail (400)
        await book('23:00', '222', 400, 'Booking after close (23:00)');

        // 4. Test: Valid Booking (12:00) -> Should success (200)
        await book('12:00', '333', 200, 'Valid Booking (12:00)');

        // 5. Test: Rest of Day Check (14:00) -> Should fail (409) because 12:00 exists
        await book('14:00', '444', 409, 'Rest of Day Block (14:00 blocked by 12:00)');

        // 6. Test: Overlap Check (11:30) -> Should fail (409) because starts before 12:00 but overlaps
        await book('11:30', '555', 409, 'Overlap Block (11:30 blocked by 12:00)');

        // 7. Test: Valid Booking Before (10:00) -> Should success (200) - Assuming 10:00-11:00 doesn't overlap 12:00 (1h buffer: 12:00 blocks 11:00-13:00? No, 12:00 blocks +/- 1 hour means <13:00 and >11:00.)
        // If 12:00 is booked. 
        // Buffer logic: date_time > (12:00 - 1h) AND date_time < (12:00 + 1h).
        // range: > 11:00 AND < 13:00.
        // So 11:00 is allowed? "date_time > 11:00". 11:00 is not > 11:00. So allowed.
        // 10:00 is definitely allowed.
        // And "Rest of day": Check for bookings <= 10:00. 12:00 is not <= 10:00.
        await book('10:00', '666', 200, 'Valid Earlier Booking (10:00)');


    } catch (err) {
        console.error('Test execution failed:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
};

runTests();
