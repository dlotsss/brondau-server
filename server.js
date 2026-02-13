import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import webpush from 'web-push';

dotenv.config();
import pool from './db.js';

// ============ WEB PUSH SETUP ============
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushToSubscriptions(subscriptions, payload) {
  const payloadStr = JSON.stringify(payload);
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
        },
        payloadStr
      );
    } catch (err) {
      console.error('Push send error:', err.statusCode || err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
      }
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// ============ AUTHENTICATION ============

// Вход для Owner (теперь с выбором одного из своих ресторанов)
app.post('/api/auth/owner', async (req, res) => {
  try {
    const { email, password, restaurantId } = req.body;

    const result = await pool.query(
      'SELECT * FROM platform_owner WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const restaurantIds = user.restaurant_ids || [];

    // Проверка соответствия выбранного ресторана
    const hasAllAccess = restaurantIds.includes('all');
    if (!hasAllAccess && !restaurantIds.includes(restaurantId)) {
      return res.status(401).json({ error: 'Access denied for this restaurant' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      id: user.id,
      email: user.email,
      role: 'OWNER',
      restaurantId: restaurantId // Возвращаем тот, который выбрали
    });
  } catch (error) {
    console.error('Owner login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить список ресторанов для владельца
app.post('/api/auth/owner/restaurants', async (req, res) => {
  try {
    const { email } = req.body;

    const ownerResult = await pool.query(
      'SELECT restaurant_ids FROM platform_owner WHERE email = $1',
      [email]
    );

    if (ownerResult.rows.length === 0) {
      return res.json([]);
    }

    const restaurantIds = ownerResult.rows[0].restaurant_ids || [];

    if (restaurantIds.includes('all')) {
      const restaurants = await pool.query('SELECT id, name FROM restaurants ORDER BY name');
      return res.json([{ id: 'all', name: 'All Restaurants (Admin Access)' }, ...restaurants.rows]);
    } else {
      const restaurants = await pool.query(
        'SELECT id, name FROM restaurants WHERE id = ANY($1) ORDER BY name',
        [restaurantIds]
      );
      return res.json(restaurants.rows);
    }
  } catch (error) {
    console.error('Get owner restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить список ресторанов для выбранного email администратора
app.post('/api/auth/admin/restaurants', async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query(`
      SELECT r.id, r.name 
      FROM admins a
      JOIN restaurants r ON a.restaurant_id = r.id
      WHERE a.email = $1
    `, [email]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get admin restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Вход администратора с выбором ресторана (оптимизированный запрос)
app.post('/api/auth/admin', async (req, res) => {
  try {
    const { email, password, restaurantId } = req.body;

    // Точечная проверка: email + restaurant_id (использует индекс)
    const result = await pool.query(
      'SELECT * FROM admins WHERE email = $1 AND restaurant_id = $2',
      [email, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      id: admin.id,
      email: admin.email,
      role: 'ADMIN',
      restaurantId: admin.restaurant_id
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PUSH SUBSCRIPTIONS ============

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { subscription, role, restaurantId, guestPhone } = req.body;

    await pool.query(`
      INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth, role, restaurant_id, guest_phone)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (endpoint) DO UPDATE SET
        keys_p256dh = EXCLUDED.keys_p256dh,
        keys_auth = EXCLUDED.keys_auth,
        role = EXCLUDED.role,
        restaurant_id = EXCLUDED.restaurant_id,
        guest_phone = EXCLUDED.guest_phone
    `, [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      role,
      restaurantId || null,
      guestPhone || null
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.json({ success: true });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ RESTAURANTS ============

app.get('/api/restaurants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM restaurants ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/restaurants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM restaurants WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get restaurant error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query(
      'INSERT INTO restaurants (name, layout) VALUES ($1, $2) RETURNING *',
      [name, JSON.stringify([])]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create restaurant error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/restaurants/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    const { layout, floors } = req.body;

    let columns = ['layout = $1'];
    let params = [JSON.stringify(layout)];

    if (floors) {
      columns.push('floors = $2');
      params.push(JSON.stringify(floors));
    }

    const query = `UPDATE restaurants SET ${columns.join(', ')} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);

    const result = await pool.query(query, params);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update layout error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ BOOKINGS ============

app.get('/api/restaurants/:restaurantId/bookings', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query(
      'SELECT * FROM bookings WHERE restaurant_id = $1 ORDER BY date_time DESC',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/restaurants/:restaurantId/bookings', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { tableId, tableLabel, guestName, guestPhone, guestCount, dateTime } = req.body;

    const normalizedPhone = String(guestPhone || '').replace(/\D/g, '');
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // 1. Fetch Restaurant Work Hours
    const restaurantResult = await pool.query(
      'SELECT work_starts, work_ends FROM restaurants WHERE id = $1',
      [restaurantId]
    );

    if (restaurantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const { work_starts, work_ends } = restaurantResult.rows[0];
    // Default if null (though schema has defaults, good to be safe)
    const startStr = work_starts || '10:00';
    const endStr = work_ends || '23:00';

    const bookingDate = new Date(dateTime);
    const bookingH = bookingDate.getHours();
    const bookingM = bookingDate.getMinutes();

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    // Determine Shift Context
    // If booking time (e.g. 01:00) is earlier than start time (10:00), it *might* belong to previous day's shift (if ends next day).
    // Logic: calculate ShiftStart relative to bookingDate.

    let shiftStart = new Date(bookingDate);
    shiftStart.setHours(startH, startM, 0, 0);

    // If booking is 01:00 and start is 10:00, the 'same day' shift start is 10:00 (future).
    // So this booking must belong to 'yesterday' shift.
    // BUT we must verify if the restaurant actually operates overnight.
    // Or if the booking is just invalid (too early).

    // Simplest robust check:
    // Construct candidates for ShiftStart: Same Day, or Previous Day.
    // See which one contains the bookingDate.

    let validShiftStart = null;
    let validShiftEnd = null;

    // Check "Today's" shift (relative to booking date)
    let s1 = new Date(bookingDate);
    s1.setHours(startH, startM, 0, 0);
    let e1 = new Date(s1);
    e1.setHours(endH, endM, 0, 0);
    if (endH < startH || (endH === startH && endM < startM)) {
      e1.setDate(e1.getDate() + 1); // Ends next day
    }

    // Check "Yesterday's" shift
    let s0 = new Date(s1);
    s0.setDate(s0.getDate() - 1);
    let e0 = new Date(s0); // Start from s0 base
    e0.setHours(endH, endM, 0, 0);
    if (endH < startH || (endH === startH && endM < startM)) {
      e0.setDate(e0.getDate() + 1);
    }

    if (bookingDate >= s1 && bookingDate < e1) {
      validShiftStart = s1;
      validShiftEnd = e1;
    } else if (bookingDate >= s0 && bookingDate < e0) {
      validShiftStart = s0;
      validShiftEnd = e0;
    }

    if (!validShiftStart) {
      return res.status(400).json({ error: `Booking time must be within working hours (${startStr} - ${endStr})` });
    }

    // 1.5 Challenge: Must be at least 1 hour before closing
    const lastPossibleBooking = new Date(validShiftEnd.getTime() - 60 * 60 * 1000);
    if (bookingDate > lastPossibleBooking) {
      return res.status(400).json({ error: 'The last possible booking time is one hour before closing.' });
    }

    // 2. Existing Booking Validation (Phone)
    const existingBookingResult = await pool.query(
      `SELECT id
       FROM bookings
       WHERE restaurant_id = $1
         AND regexp_replace(guest_phone, '\\D', '', 'g') = $2
         AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
       LIMIT 1`,
      [restaurantId, normalizedPhone]
    );

    if (existingBookingResult.rows.length > 0) {
      return res.status(409).json({ error: 'A booking for this phone number already exists' });
    }

    // 3. "Rest of Day" Block Check:
    // Check for any booking on this table in the SAME SHIFT that is BEFORE or AT the requested time.
    // Effectively, finding a booking at T_exist <= T_new means T_new is blocked.
    const restOfDayBlockResult = await pool.query(
      `SELECT id
       FROM bookings
       WHERE restaurant_id = $1
         AND table_id = $2
         AND date_time >= $3
         AND date_time <= $4
         AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
       LIMIT 1`,
      [restaurantId, tableId, validShiftStart, dateTime]
    );

    if (restOfDayBlockResult.rows.length > 0) {
      return res.status(409).json({ error: 'This table is already occupied by an earlier booking for the rest of the day.' });
    }

    // 4. Overlap Check (Forward looking / Vicinity)
    // We strictly need to prevent cases where new booking starts BEFORE existing one but overlaps.
    // E.g. New=18:00. Existing=18:30.
    // "Rest of Day" check looks for <= 18:00. Finds nothing.
    // But 18:00 overlaps 18:30 (buffer).
    const doubleBookingResult = await pool.query(
      `SELECT id
       FROM bookings
       WHERE restaurant_id = $1
         AND table_id = $2
         AND date_time > ($3::timestamp - INTERVAL '1 hour')
         AND date_time < ($3::timestamp + INTERVAL '1 hour')
         AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
       LIMIT 1`,
      [restaurantId, tableId, dateTime]
    );

    if (doubleBookingResult.rows.length > 0) {
      return res.status(409).json({ error: 'This table is already booked near the selected time (1 hour buffer)' });
    }

    const result = await pool.query(`
      INSERT INTO bookings (restaurant_id, table_id, table_label, guest_name, guest_phone, guest_count, date_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [restaurantId, tableId, tableLabel, guestName, normalizedPhone, guestCount, dateTime]);

    // Send push to admins of this restaurant
    try {
      const adminSubs = await pool.query(
        `SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE role = 'ADMIN' AND restaurant_id = $1`,
        [restaurantId]
      );
      if (adminSubs.rows.length > 0) {
        const bookingTime = new Date(dateTime).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        await sendPushToSubscriptions(adminSubs.rows, {
          title: 'Новый запрос на бронирование',
          body: `${guestName} — стол ${tableLabel}, ${bookingTime}, ${guestCount} гостей`,
          tag: `booking-${result.rows[0].id}`
        });
      }
    } catch (pushErr) {
      console.error('Push notification error (admin):', pushErr);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, declineReason } = req.body;

    const result = await pool.query(
      'UPDATE bookings SET status = $1, decline_reason = $2 WHERE id = $3 RETURNING *',
      [status, declineReason || null, id]
    );

    const booking = result.rows[0];

    // Send push to guest when booking is confirmed or declined
    if (booking && (status === 'CONFIRMED' || status === 'DECLINED')) {
      try {
        const normalizedPhone = String(booking.guest_phone || '').replace(/\D/g, '');
        const guestSubs = await pool.query(
          `SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE role = 'GUEST' AND guest_phone = $1`,
          [normalizedPhone]
        );
        if (guestSubs.rows.length > 0) {
          let title, body;
          if (status === 'CONFIRMED') {
            // Fetch restaurant details for the confirmed notification
            const restResult = await pool.query('SELECT name, address FROM restaurants WHERE id = $1', [booking.restaurant_id]);
            const rest = restResult.rows[0];
            title = 'Бронирование подтверждено ✅';
            body = `${rest?.name || ''}${rest?.address ? ', ' + rest.address : ''} — стол ${booking.table_label}, ${new Date(booking.date_time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
          } else {
            title = 'Бронирование отклонено ❌';
            body = declineReason || 'Ваше бронирование было отклонено.';
          }
          await sendPushToSubscriptions(guestSubs.rows, {
            title,
            body,
            tag: `booking-status-${booking.id}`
          });
        }
      } catch (pushErr) {
        console.error('Push notification error (guest):', pushErr);
      }
    }

    res.json(booking);
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Автоматическая отмена старых pending броней
app.post('/api/bookings/cleanup-expired', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE bookings 
      SET status = 'DECLINED', 
          decline_reason = 'Automatic cancellation: No response from administrator.'
      WHERE status = 'PENDING' 
        AND created_at < NOW() - INTERVAL '3 minutes'
      RETURNING *
    `);

    res.json({ updated: result.rows.length, bookings: result.rows });
  } catch (error) {
    console.error('Cleanup expired bookings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ ADMINS (только для Owner) ============

app.post('/api/admins', async (req, res) => {
  try {
    const { restaurantId, email, password } = req.body;

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO admins (restaurant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, restaurant_id, email',
      [restaurantId, email, passwordHash]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: 'Admin already exists for this restaurant' });
    }
    console.error('Create admin error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/restaurants/:restaurantId/admins', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query(
      'SELECT id, email, created_at FROM admins WHERE restaurant_id = $1',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});