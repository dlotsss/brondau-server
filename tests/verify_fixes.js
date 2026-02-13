
import { spawn } from 'child_process';
import pg from 'pg';

const { Pool } = pg;
const PORT = 3005;
const API_URL = `http://localhost:${PORT}/api`;

const pool = new Pool({
    user: 'avnadmin',
    password: 'AVNS_QJEsuUI1dU6xaP3hUXE',
    host: 'brondau-brondau.i.aivencloud.com',
    port: 27752,
    database: 'defaultdb',
    ssl: { rejectUnauthorized: false }
});

async function runTests() {
    console.log('Starting test server...');
    const serverProcess = spawn('node', ['server.js'], {
        cwd: '../', // Run from server root
        env: { ...process.env, PORT: PORT.toString() },
        stdio: 'inherit',
        shell: true
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
        // 1. Get a restaurant
        console.log('Fetching restaurants...');
        const restaurantsRes = await fetch(`${API_URL}/restaurants`);
        const restaurants = await restaurantsRes.json();
        if (restaurants.length === 0) {
            console.error('No restaurants found. Cannot test.');
            return;
        }
        const restaurant = restaurants[0];
        console.log(`Using restaurant: ${restaurant.id}`);

        // 2. Create Base Booking (T)
        // Ensure we pick a time that overrides any previous test data or is far enough in future.
        // Using +2 days to be safe from previous run +1 day.
        const baseTime = new Date(Date.now() + 172800000);
        const bookingData = {
            tableId: 'test-table-overlap-' + Date.now(),
            tableLabel: 'T-Overlap',
            guestName: 'Base Guest',
            guestPhone: Math.floor(Math.random() * 10000000000).toString(),
            guestCount: 2,
            dateTime: baseTime.toISOString()
        };

        console.log(`Creating Base Booking at ${bookingData.dateTime}...`);
        const createRes = await fetch(`${API_URL}/restaurants/${restaurant.id}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        let baseBooking;
        if (!createRes.ok) {
            console.error('Failed to create base booking:', await createRes.text());
            // Attempt to recover if conflict? No, strict test.
            return;
        } else {
            baseBooking = await createRes.json();
            console.log('Created Base Booking:', baseBooking.id);

            // VERIFY TIMEZONE
            if (baseBooking.created_at && baseBooking.created_at.endsWith('Z')) {
                console.log('✅ PASSED: created_at ends with Z (UTC)');
            } else {
                console.error('❌ FAILED: created_at does not end with Z:', baseBooking.created_at);
            }
        }

        // 3. Test Overlap (+30 mins) -> Should FAIL
        console.log('Testing Overlap (+30 mins)...');
        const overlapTime = new Date(baseTime.getTime() + 30 * 60000);
        const overlapData = {
            ...bookingData,
            guestPhone: Math.floor(Math.random() * 10000000000).toString(),
            dateTime: overlapTime.toISOString()
        };

        const overlapRes = await fetch(`${API_URL}/restaurants/${restaurant.id}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(overlapData)
        });

        if (overlapRes.status === 409) {
            const err = await overlapRes.json();
            console.log(`✅ PASSED: Overlap booking prevented. Msg: ${err.error}`);
        } else {
            console.error(`❌ FAILED: Overlap booking allowed! Status: ${overlapRes.status}`);
        }

        // 4. Test Safe Distance (+90 mins) -> Should SUCCEED
        console.log('Testing Safe Distance (+90 mins)...');
        const safeTime = new Date(baseTime.getTime() + 90 * 60000);
        const safeData = {
            ...bookingData,
            guestPhone: Math.floor(Math.random() * 10000000000).toString(),
            dateTime: safeTime.toISOString()
        };

        const safeRes = await fetch(`${API_URL}/restaurants/${restaurant.id}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(safeData)
        });

        if (safeRes.ok) {
            console.log('✅ PASSED: Safe distance booking succeeded.');
        } else {
            console.error(`❌ FAILED: Safe distance booking failed! Status: ${safeRes.status}`);
        }

        // 5. Test Admin Cancellation
        console.log('Testing Admin Cancellation...');
        const cancelRes = await fetch(`${API_URL}/bookings/${baseBooking.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'DECLINED', declineReason: 'Cancelled by Admin Test' })
        });

        if (cancelRes.ok) {
            const updated = await cancelRes.json();
            if (updated.status === 'DECLINED') {
                console.log('✅ PASSED: Admin cancellation succeeded.');
            } else {
                console.error(`❌ FAILED: Admin cancellation status mismatch: ${updated.status}`);
            }
        } else {
            console.error(`❌ FAILED: Admin cancellation request failed! Status: ${cancelRes.status}`);
        }

    } catch (error) {
        console.error('Test error:', error);
    } finally {
        console.log('Stopping server...');
        serverProcess.kill();
        pool.end();
    }
}

runTests();
