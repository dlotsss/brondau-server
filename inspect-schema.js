import pool from './db.js';

async function inspectCompletedBookings() {
  try {
    const res = await pool.query(`
      SELECT id, status, date_time, duration, created_at, updated_at 
      FROM bookings 
      WHERE status = 'COMPLETED'
      LIMIT 10
    `);
    console.log('Completed bookings sample:');
    console.log(res.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}

inspectCompletedBookings();
