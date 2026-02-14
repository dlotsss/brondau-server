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

// Хелпер для форматирования даты в локальное время для уведомлений
function formatBookingDate(isoDateString, offsetMinutes) {
  const date = new Date(isoDateString);
  
  if (offsetMinutes !== undefined && offsetMinutes !== null) {
    const localTime = new Date(date.getTime() - (offsetMinutes * 60 * 1000));
    return localTime.toLocaleString('ru-RU', {
      timeZone: 'UTC',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }
  
  return date.toLocaleString('ru-RU', {
    timeZone: process.env.TZ || 'Asia/Almaty',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

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

app.post('/api/auth/owner', async (req, res) => {
  try {
    const { email, password, restaurantId } = req.body;
    const result = await pool.query('SELECT * FROM platform_owner WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const restaurantIds = user.restaurant_ids || [];
    const hasAllAccess = restaurantIds.includes('all');
    if (!hasAllAccess && !restaurantIds.includes(restaurantId)) return res.status(401).json({ error: 'Access denied for this restaurant' });
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: user.id, email: user.email, role: 'OWNER', restaurantId: restaurantId });
  } catch (error) {
    console.error('Owner login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/owner/restaurants', async (req, res) => {
  try {
    const { email } = req.body;
    const ownerResult = await pool.query('SELECT restaurant_ids FROM platform_owner WHERE email = $1', [email]);
    if (ownerResult.rows.length === 0) return res.json([]);
    const restaurantIds = ownerResult.rows[0].restaurant_ids || [];
    if (restaurantIds.includes('all')) {
      const restaurants = await pool.query('SELECT id, name FROM restaurants ORDER BY name');
      return res.json([{ id: 'all', name: 'All Restaurants (Admin Access)' }, ...restaurants.rows]);
    } else {
      const restaurants = await pool.query('SELECT id, name FROM restaurants WHERE id = ANY($1) ORDER BY name', [restaurantIds]);
      return res.json(restaurants.rows);
    }
  } catch (error) {
    console.error('Get owner restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/admin/restaurants', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await pool.query(`SELECT r.id, r.name FROM admins a JOIN restaurants r ON a.restaurant_id = r.id WHERE a.email = $1`, [email]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get admin restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/admin', async (req, res) => {
  try {
    const { email, password, restaurantId } = req.body;
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 AND restaurant_id = $2', [email, restaurantId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ id: admin.id, email: admin.email, role: 'ADMIN', restaurantId: admin.restaurant_id });
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
    `, [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, role, restaurantId || null, guestPhone || null]);
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
    if (result.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get restaurant error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query('INSERT INTO restaurants (name, layout) VALUES ($1, $2) RETURNING *', [name, JSON.stringify([])]);
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
    const result = await pool.query('SELECT * FROM bookings WHERE restaurant_id = $1 ORDER BY date_time DESC', [restaurantId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/restaurants/:restaurantId/bookings', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { tableId, tableLabel, guestName, guestPhone, guestCount, dateTime, timezoneOffset } = req.body;

    const normalizedPhone = String(guestPhone || '').replace(/\D/g, '');
    if (!normalizedPhone) return res.status(400).json({ error: 'Phone number is required' });

    // 1. Fetch Restaurant Work Hours
    const restaurantResult = await pool.query('SELECT work_starts, work_ends FROM restaurants WHERE id = $1', [restaurantId]);
    if (restaurantResult.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    const { work_starts, work_ends } = restaurantResult.rows[0];
    const startStr = work_starts || '10:00';
    const endStr = work_ends || '23:00';

    const bookingDate = new Date(dateTime);
    const validationDate = new Date(bookingDate);
    if (timezoneOffset !== undefined) {
      validationDate.setMinutes(validationDate.getMinutes() - timezoneOffset);
    }

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    // Determine Shift Context
    let validShiftStart = null;
    let validShiftEnd = null;
    let s1 = new Date(validationDate); s1.setUTCHours(startH, startM, 0, 0);
    let e1 = new Date(s1); e1.setUTCHours(endH, endM, 0, 0);
    if (endH < startH || (endH === startH && endM < startM)) e1.setUTCDate(e1.getUTCDate() + 1);
    let s0 = new Date(s1); s0.setUTCDate(s0.getUTCDate() - 1);
    let e0 = new Date(s0); e0.setUTCHours(endH, endM, 0, 0);
    if (endH < startH || (endH === startH && endM < startM)) e0.setUTCDate(e0.getUTCDate() + 1);

    if (validationDate >= s1 && validationDate < e1) {
      validShiftStart = s1; validShiftEnd = e1;
    } else if (validationDate >= s0 && validationDate < e0) {
      validShiftStart = s0; validShiftEnd = e0;
    }

    if (!validShiftStart) return res.status(400).json({ error: `Booking time must be within working hours (${startStr} - ${endStr})` });

    const lastPossibleBooking = new Date(validShiftEnd.getTime() - 60 * 60 * 1000);
    if (validationDate > lastPossibleBooking) return res.status(400).json({ error: 'The last possible booking time is one hour before closing.' });

    // 2. Existing Booking Validation (Phone)
    const existingBookingResult = await pool.query(
      `SELECT id FROM bookings WHERE restaurant_id = $1 AND regexp_replace(guest_phone, '\\D', '', 'g') = $2 AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED') LIMIT 1`,
      [restaurantId, normalizedPhone]
    );
    if (existingBookingResult.rows.length > 0) return res.status(409).json({ error: 'A booking for this phone number already exists' });

    // 3. !!! НОВАЯ ПРОВЕРКА: "Rest of Day Block" !!!
    // Проверяем, есть ли ЛЮБАЯ активная бронь (Pending/Confirmed/Occupied),
    // которая начинается РАНЬШЕ или В ТО ЖЕ ВРЕМЯ, что и новая бронь, в ту же смену.
    // Если есть — стол считается занятым до конца дня (пока админ не нажмет Completed/Declined).
    const restOfDayBlockResult = await pool.query(
      `SELECT id
       FROM bookings
       WHERE restaurant_id = $1
         AND table_id = $2
         AND date_time >= $3 -- Начало смены
         AND date_time <= $4 -- Время новой брони (или раньше)
         AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED') -- Активные статусы (не COMPLETED)
       LIMIT 1`,
      [restaurantId, tableId, validShiftStart, dateTime]
    );

    if (restOfDayBlockResult.rows.length > 0) {
      return res.status(409).json({ error: 'This table is occupied for the rest of the day by an earlier booking.' });
    }

    // 4. Overlap Check (На случай если кто-то пытается забронировать чуть раньше существующей)
    // Например: Бронь на 19:00 есть. Пытаемся забронировать на 18:30 (буфер).
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
    if (doubleBookingResult.rows.length > 0) return res.status(409).json({ error: 'This table is already booked near the selected time.' });

    const result = await pool.query(`
      INSERT INTO bookings (restaurant_id, table_id, table_label, guest_name, guest_phone, guest_count, date_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [restaurantId, tableId, tableLabel, guestName, normalizedPhone, guestCount, dateTime]);

    try {
      const adminSubs = await pool.query(`SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE role = 'ADMIN' AND restaurant_id = $1`, [restaurantId]);
      if (adminSubs.rows.length > 0) {
        const bookingTime = formatBookingDate(dateTime, timezoneOffset);
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
    const result = await pool.query('UPDATE bookings SET status = $1, decline_reason = $2 WHERE id = $3 RETURNING *', [status, declineReason || null, id]);
    const booking = result.rows[0];

    if (booking && (status === 'CONFIRMED' || status === 'DECLINED')) {
      try {
        const normalizedPhone = String(booking.guest_phone || '').replace(/\D/g, '');
        const guestSubs = await pool.query(`SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE role = 'GUEST' AND guest_phone = $1`, [normalizedPhone]);
        if (guestSubs.rows.length > 0) {
          let title, body;
          const formattedDate = formatBookingDate(booking.date_time, null);
          if (status === 'CONFIRMED') {
            const restResult = await pool.query('SELECT name, address FROM restaurants WHERE id = $1', [booking.restaurant_id]);
            const rest = restResult.rows[0];
            title = 'Бронирование подтверждено ✅';
            body = `${rest?.name || ''}${rest?.address ? ', ' + rest.address : ''} — стол ${booking.table_label}, ${formattedDate}`;
          } else {
            title = 'Бронирование отклонено ❌';
            body = declineReason || 'Ваше бронирование было отклонено.';
          }
          await sendPushToSubscriptions(guestSubs.rows, { title, body, tag: `booking-status-${booking.id}` });
        }
      } catch (pushErr) { console.error('Push notification error (guest):', pushErr); }
    }
    res.json(booking);
  } catch (error) { console.error('Update booking status error:', error); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/bookings/cleanup-expired', async (req, res) => {
  try {
    const result = await pool.query(`UPDATE bookings SET status = 'DECLINED', decline_reason = 'Automatic cancellation' WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '1 hour' RETURNING *`);
    
    res.json({ updated: result.rows.length, bookings: result.rows });
  } catch (error) { 
    console.error('Cleanup error:', error); 
    res.status(500).json({ error: 'Server error' }); 
  }
});

app.post('/api/admins', async (req, res) => {
  try {
    const { restaurantId, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO admins (restaurant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, restaurant_id, email', [restaurantId, email, passwordHash]);
    res.json(result.rows[0]);
  } catch (error) { if (error.code === '23505') return res.status(400).json({ error: 'Admin exists' }); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/restaurants/:restaurantId/admins', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query('SELECT id, email, created_at FROM admins WHERE restaurant_id = $1', [restaurantId]);
    res.json(result.rows);
  } catch (error) { console.error('Get admins error:', error); res.status(500).json({ error: 'Server error' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

