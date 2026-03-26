import express from 'express';
import bcrypt from 'bcrypt';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const router = express.Router();

// ============ EMAIL HELPERS ============

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
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) return console.error('RESEND_API_KEY is missing');
  if (!process.env.EMAIL_FROM) return console.error('EMAIL_FROM is missing');
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
    });
  } catch (e) {
    console.error('Resend email error:', e?.message || e);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ============ AUTHENTICATION ============

router.post('/auth/owner', async (req, res) => {
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

router.post('/auth/owner/restaurants', async (req, res) => {
  try {
    const { email } = req.body;
    const ownerResult = await pool.query('SELECT restaurant_ids FROM platform_owner WHERE email = $1', [email]);
    if (ownerResult.rows.length === 0) return res.json([]);
    const restaurantIds = ownerResult.rows[0].restaurant_ids || [];
    if (restaurantIds.includes('all')) {
      const restaurants = await pool.query('SELECT id, name, with_map FROM restaurants ORDER BY name');
      return res.json([{ id: 'all', name: 'All Restaurants (Admin Access)' }, ...restaurants.rows]);
    } else {
      const restaurants = await pool.query('SELECT id, name, with_map FROM restaurants WHERE id = ANY($1) ORDER BY name', [restaurantIds]);
      return res.json(restaurants.rows);
    }
  } catch (error) {
    console.error('Get owner restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/auth/admin/restaurants', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await pool.query(`SELECT r.id, r.name, r.with_map FROM admins a JOIN restaurants r ON a.restaurant_id = r.id WHERE a.email = $1`, [email]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get admin restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/auth/admin', async (req, res) => {
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

// ============ RESTAURANTS ============

router.get('/restaurants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM restaurants ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get restaurants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/restaurants/:id', async (req, res) => {
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

router.post('/restaurants', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query('INSERT INTO restaurants (name, layout) VALUES ($1, $2) RETURNING *', [name, JSON.stringify([])]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create restaurant error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/restaurants/:id/layout', async (req, res) => {
  try {
    const { id } = req.params;
    const { layout, floors, bookingRestriction } = req.body;
    let columns = [];
    let params = [];
    let paramIndex = 1;

    if (layout !== undefined) {
      columns.push(`layout = $${paramIndex++}`);
      params.push(JSON.stringify(layout));
    }
    if (floors !== undefined) {
      columns.push(`floors = $${paramIndex++}`);
      params.push(JSON.stringify(floors));
    }
    if (bookingRestriction !== undefined) {
      columns.push(`booking_restriction = $${paramIndex++}`);
      params.push(bookingRestriction);
    }

    if (columns.length === 0) return res.status(400).json({ error: 'No fields to update' });

    const query = `UPDATE restaurants SET ${columns.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update layout error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ BOOKINGS ============

router.get('/restaurants/:restaurantId/bookings', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query(`
      SELECT 
        b.*,
        COALESCE(
          (SELECT json_agg(bt.table_id) FROM booking_tables bt WHERE bt.booking_id = b.id), 
          '[]'::json
        ) as "tableIds",
        COALESCE(
          (SELECT json_agg(bt.table_label) FROM booking_tables bt WHERE bt.booking_id = b.id), 
          '[]'::json
        ) as "tableLabels"
      FROM bookings b 
      WHERE b.restaurant_id = $1 
      ORDER BY b.date_time DESC
    `, [restaurantId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/restaurants/:restaurantId/staff-names', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query(
      'SELECT name FROM staff_names WHERE restaurant_id = $1 ORDER BY name',
      [restaurantId]
    );
    res.json(result.rows.map(r => r.name));
  } catch (error) {
    console.error('Get staff names error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/restaurants/:restaurantId/bookings', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { tableId, tableLabel, guestName, guestPhone, guestEmail, guestCount, dateTime, timezoneOffset, isAdmin, guestComment, assignedTo } = req.body;

    const normalizedPhone = String(guestPhone || '').replace(/\D/g, '');
    const normalizedEmail = guestEmail?.trim().toLowerCase() || null;

    if (!isAdmin && !normalizedPhone) return res.status(400).json({ error: 'Phone number is required' });
    if (!isAdmin && !normalizedEmail) return res.status(400).json({ error: 'Email is required' });

    const restaurantResult = await pool.query('SELECT name, work_starts, work_ends, schedule, with_map, booking_restriction FROM restaurants WHERE id = $1', [restaurantId]);
    if (restaurantResult.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });
    const { name: restaurantName, work_starts, work_ends, schedule, with_map, booking_restriction } = restaurantResult.rows[0];

    const { duration: requestedDuration } = req.body;
    const bookingDuration = requestedDuration || (booking_restriction !== -1 ? booking_restriction : 60);

    const bookingDate = new Date(dateTime);
    const validationDate = new Date(bookingDate);
    if (timezoneOffset !== undefined) {
      validationDate.setMinutes(validationDate.getMinutes() - timezoneOffset);
    }

    const getSchedule = (dayIndex) => {
      if (schedule && schedule[dayIndex]) return schedule[dayIndex];
      return { start: work_starts || '10:00', end: work_ends || '23:00' };
    };

    const todayDay = validationDate.getUTCDay();
    const yesterdayDate = new Date(validationDate);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayDay = yesterdayDate.getUTCDay();

    const todaySched = getSchedule(todayDay);
    const yestSched = getSchedule(yesterdayDay);

    let [tH, tM] = todaySched.start.split(':').map(Number);
    let [tEH, tEM] = todaySched.end.split(':').map(Number);
    let s1 = new Date(validationDate); s1.setUTCHours(tH, tM, 0, 0);
    let e1 = new Date(s1); e1.setUTCHours(tEH, tEM, 0, 0);
    if (tEH < tH || (tEH === tH && tEM < tM)) e1.setUTCDate(e1.getUTCDate() + 1);

    let [yH, yM] = yestSched.start.split(':').map(Number);
    let [yEH, yEM] = yestSched.end.split(':').map(Number);
    let s0 = new Date(yesterdayDate); s0.setUTCHours(yH, yM, 0, 0);
    let e0 = new Date(s0); e0.setUTCHours(yEH, yEM, 0, 0);
    if (yEH < yH || (yEH === yH && yEM < yM)) e0.setUTCDate(e0.getUTCDate() + 1);

    let validShiftStart = null;
    let validShiftEnd = null;
    let appliedStartStr = '';
    let appliedEndStr = '';

    if (validationDate >= s1 && validationDate < e1) {
      validShiftStart = s1; validShiftEnd = e1;
      appliedStartStr = todaySched.start; appliedEndStr = todaySched.end;
    } else if (validationDate >= s0 && validationDate < e0) {
      validShiftStart = s0; validShiftEnd = e0;
      appliedStartStr = yestSched.start; appliedEndStr = yestSched.end;
    }

    if (!isAdmin) {
      if (!validShiftStart) return res.status(400).json({ error: `Время бронирования должно быть в рабочие часы (${appliedStartStr} - ${appliedEndStr})` });

      const now = new Date();
      if (timezoneOffset !== undefined) {
          now.setMinutes(now.getMinutes() - timezoneOffset);
      }
      const minBookingTime = new Date(now.getTime() + 60 * 60 * 1000);
      if (validationDate < minBookingTime) return res.status(400).json({ error: 'Бронирование доступно минимум за 1 час до начала.' });

      const lastPossibleBooking = new Date(validShiftEnd.getTime() - 60 * 60 * 1000);
      if (validationDate > lastPossibleBooking) return res.status(400).json({ error: 'Предпоследняя бронь возможна за час до закрытия.' });

      const existingBookingResult = await pool.query(
        `SELECT id FROM bookings WHERE restaurant_id = $1 AND regexp_replace(guest_phone, '\\D', '', 'g') = $2 AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED') LIMIT 1`,
        [restaurantId, normalizedPhone]
      );
      if (existingBookingResult.rows.length > 0) return res.status(409).json({ error: 'A booking for this phone number already exists' });

      // Capacity-based logic for guest bookings
      if (with_map !== false && tableId) {
        // Specific table check
        const conflictResult = await pool.query(
          `SELECT id FROM bookings 
           WHERE restaurant_id = $1 AND table_id = $2 
           AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
           AND (date_time, (COALESCE(duration, $3) || ' minutes')::interval) OVERLAPS ($4, ($5 || ' minutes')::interval)
           LIMIT 1`,
          [restaurantId, tableId, booking_restriction !== -1 ? booking_restriction : 60, dateTime, bookingDuration]
        );

        if (conflictResult.rows.length > 0) {
          return res.status(409).json({ error: 'Этот столик уже занят в выбранное время или рядом с ним.' });
        }
      } else {
        // Capacity check for non-map or no-table bookings
        // 1. Get total tables
        const layoutResult = await pool.query('SELECT layout FROM restaurants WHERE id = $1', [restaurantId]);
        const layout = layoutResult.rows[0]?.layout || [];
        const totalTables = layout.filter(l => l.type === 'table').length || 1;

        // 2. Count overlapping bookings
        const countResult = await pool.query(
          `SELECT COUNT(*) as overlap_count FROM bookings 
           WHERE restaurant_id = $1 
           AND status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
           AND (date_time, (COALESCE(duration, $2) || ' minutes')::interval) OVERLAPS ($3, ($4 || ' minutes')::interval)`,
          [restaurantId, booking_restriction !== -1 ? booking_restriction : 60, dateTime, bookingDuration]
        );

        const overlapCount = parseInt(countResult.rows[0]?.overlap_count || 0);
        if (overlapCount >= totalTables) {
          return res.status(409).json({ error: 'К сожалению, на это время все столики уже забронированы.' });
        }
      }
    }

    const status = isAdmin ? 'CONFIRMED' : 'PENDING';

    // Upsert guest
    if (normalizedPhone) {
      try {
        await pool.query(`
          INSERT INTO guests (phone, name, email)
          VALUES ($1, $2, $3)
          ON CONFLICT (phone) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            updated_at = CURRENT_TIMESTAMP
        `, [normalizedPhone, guestName, normalizedEmail]);
      } catch (guestErr) {
        console.error('Failed to upsert guest:', guestErr);
      }
    }

    const result = await pool.query(`
      INSERT INTO bookings (restaurant_id, table_id, table_label, guest_name, guest_phone, guest_email, guest_count, date_time, status, guest_comment, duration, assigned_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [restaurantId, tableId || null, tableLabel || null, guestName, normalizedPhone, normalizedEmail, guestCount, dateTime, status, guestComment || null, bookingDuration, assignedTo || null]);

    // Auto-save staff name for autocomplete
    if (assignedTo && assignedTo.trim()) {
      pool.query(
        `INSERT INTO staff_names (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id, name) DO NOTHING`,
        [restaurantId, assignedTo.trim()]
      ).catch(() => {});
    }

    if (!isAdmin) {
      const bookingTime = formatBookingDate(dateTime, timezoneOffset);
      const eName = escapeHtml(guestName);
      const eTable = escapeHtml(tableLabel || 'Ожидает назначения');

      try {
        const adminRows = await pool.query('SELECT email FROM admins WHERE restaurant_id = $1', [restaurantId]);
        const adminEmails = adminRows.rows.map(r => r.email).filter(Boolean);
        if (adminEmails.length > 0) {
          await sendEmail({
            to: adminEmails,
            subject: `Новый запрос на бронирование, ${restaurantName}`,
            html: `<h2>Новый запрос на бронирование</h2>
<p><b>Имя:</b> ${eName}</p>
<p><b>Телефон:</b> ${escapeHtml(normalizedPhone)}</p>
<p><b>Email:</b> ${escapeHtml(normalizedEmail)}</p>
<p><b>Стол:</b> ${eTable}</p>
<p><b>Время:</b> ${escapeHtml(bookingTime)}</p>
<p><b>Гостей:</b> ${guestCount}</p>`,
            text: `Новый запрос на бронирование\nИмя: ${guestName}\nТелефон: ${normalizedPhone}\nEmail: ${normalizedEmail}\nСтол: ${tableLabel || 'Ожидает назначения'}\nВремя: ${bookingTime}\nГостей: ${guestCount}`,
          });
        }
      } catch (emailErr) {
        console.error('Email notification error (admin):', emailErr);
      }

      try {
        await sendEmail({
          to: normalizedEmail,
          subject: `Запрос на бронирование принят, ${restaurantName}`,
          html: `<h2>Ваш запрос на бронирование принят</h2>
<p><b>Стол:</b> ${eTable}</p>
<p><b>Время:</b> ${escapeHtml(bookingTime)}</p>
<p><b>Гостей:</b> ${guestCount}</p>
<p>Вам придёт письмо после решения администратора.</p>`,
          text: `Ваш запрос на бронирование принят\nСтол: ${tableLabel || 'Ожидает назначения'}\nВремя: ${bookingTime}\nГостей: ${guestCount}\nВам придёт письмо после решения администратора.`,
        });
      } catch (emailErr) {
        console.error('Email notification error (guest):', emailErr);
      }
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, declineReason, tableId, tableLabel, duration, tableIds, tableLabels, assignedTo } = req.body;

    const finalTableIds = tableIds || (tableId ? [tableId] : []);
    const finalTableLabels = tableLabels || (tableLabel ? [tableLabel] : []);

    if (status === 'CONFIRMED' && finalTableIds.length > 0) {
       const bookingRes = await pool.query('SELECT restaurant_id, date_time, duration, guest_count FROM bookings WHERE id = $1', [id]);
       if (bookingRes.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
       const { restaurant_id, date_time, duration: currentDuration, guest_count } = bookingRes.rows[0];
       
       const restaurantRes = await pool.query('SELECT layout, booking_restriction FROM restaurants WHERE id = $1', [restaurant_id]);
       const { layout, booking_restriction } = restaurantRes.rows[0];
       
       const selectedTables = (layout || []).filter(el => el.type === 'table' && finalTableIds.includes(el.id));
       const totalSeats = selectedTables.reduce((sum, t) => sum + (t.seats || 2), 0);
       
       if (totalSeats > 0 && totalSeats < guest_count) {
           return res.status(400).json({ error: `Суммарной вместимости столов (${totalSeats}) недостаточно для ${guest_count} гостей` });
       }
       
       const bDuration = duration !== undefined ? duration : (currentDuration || (booking_restriction !== -1 ? booking_restriction : 60));
       
       const conflictQuery = `
         SELECT b.id 
         FROM bookings b
         LEFT JOIN booking_tables bt ON b.id = bt.booking_id
         WHERE b.restaurant_id = $1
           AND b.status IN ('PENDING', 'CONFIRMED', 'OCCUPIED')
           AND (b.table_id = ANY($2) OR bt.table_id = ANY($2))
           AND b.id != $3
           AND (
             b.date_time, 
             (COALESCE(b.duration, $4) || ' minutes')::interval
           ) OVERLAPS (
             $5::timestamp, 
             ($6 || ' minutes')::interval
           )
         LIMIT 1
       `;
       const overlaps = await pool.query(conflictQuery, [
         restaurant_id, finalTableIds, id, 
         booking_restriction !== -1 ? booking_restriction : 60,
         date_time, bDuration
       ]);
       
       if (overlaps.rows.length > 0) {
           return res.status(409).json({ error: 'Один или несколько выбранных столов уже заняты на это время.' });
       }
    }

    const legacyTableId = finalTableIds.length > 0 ? finalTableIds[0] : null;
    const legacyTableLabel = finalTableLabels.length > 0 ? finalTableLabels.join(', ') : null;

    let query = 'UPDATE bookings SET status = $1, decline_reason = $2';
    const params = [status, declineReason || null];
    let paramIndex = 3;

    if (duration !== undefined) {
      query += `, duration = $${paramIndex++}`;
      params.push(duration);
    }

    if (assignedTo !== undefined) {
      query += `, assigned_to = $${paramIndex++}`;
      params.push(assignedTo || null);
    }

    if (finalTableIds.length > 0 || tableId === null || (tableIds && tableIds.length === 0)) {
      query += `, table_id = $${paramIndex++}, table_label = $${paramIndex++}`;
      params.push(legacyTableId);
      params.push(legacyTableLabel);
    }

    query += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);

    const client = await pool.connect();
    let booking;
    try {
      await client.query('BEGIN');
      const result = await client.query(query, params);
      booking = result.rows[0];
      
      if (finalTableIds.length > 0 || tableId === null || (tableIds && tableIds.length === 0)) {
          await client.query('DELETE FROM booking_tables WHERE booking_id = $1', [id]);
          if (finalTableIds.length > 0) {
              const insertValues = finalTableIds.map((tId, idx) => `('${id}', '${tId}', '${(finalTableLabels[idx] || '').replace(/'/g, "''")}')`).join(', ');
              await client.query(`INSERT INTO booking_tables (booking_id, table_id, table_label) VALUES ${insertValues}`);
          }
      }
      
      await client.query('COMMIT');

      // Auto-save staff name for autocomplete
      if (assignedTo && assignedTo.trim() && booking?.restaurant_id) {
        pool.query(
          `INSERT INTO staff_names (restaurant_id, name) VALUES ($1, $2) ON CONFLICT (restaurant_id, name) DO NOTHING`,
          [booking.restaurant_id, assignedTo.trim()]
        ).catch(() => {});
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const savedStatus = String(booking?.status || '').toUpperCase();

    if (booking && (savedStatus === 'CONFIRMED' || savedStatus === 'DECLINED') && booking.guest_email) {
      try {
        const formattedDate = formatBookingDate(booking.date_time, null);
        const eTable = escapeHtml(booking.table_label || 'Не назначен');
        const restResult = await pool.query('SELECT name, address FROM restaurants WHERE id = $1', [booking.restaurant_id]);
        const rest = restResult.rows[0];
        const eName = escapeHtml(rest?.name || '');
        const eAddr = escapeHtml(rest?.address || '');

        if (savedStatus === 'CONFIRMED') {
          const origin = req.get('Origin') || (req.get('Referrer') ? new URL(req.get('Referrer')).origin : 'http://localhost:5173');
          const cancelLink = `${process.env.FRONTEND_URL || origin}/#/cancel-booking/${booking.cancellation_token}`;
          await sendEmail({
            to: booking.guest_email,
            subject: 'Бронирование подтверждено ✅',
            html: `<h2>Ваше бронирование подтверждено!</h2>
<p><b>Ресторан:</b> ${eName}${eAddr ? ', ' + eAddr : ''}</p>
<p><b>Стол:</b> ${eTable}</p>
<p><b>Время:</b> ${escapeHtml(formattedDate)}</p>
<p><b>Гостей:</b> ${booking.guest_count}</p>
<p style="margin-top: 20px;">Если ваши планы изменились, вы можете отменить бронь по ссылке ниже:</p>
<p><a href="${cancelLink}" style="background-color: #e53e3e; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Отменить бронь</a></p>`,
            text: `Ваше бронирование подтверждено!\nРесторан: ${rest?.name || ''}${rest?.address ? ', ' + rest.address : ''}\nСтол: ${booking.table_label || 'Ожидает назначения'}\nВремя: ${formattedDate}\nГостей: ${booking.guest_count}\n\nЕсли ваши планы изменились, вы можете отменить бронь по этой ссылке: ${cancelLink}`,
          });
        } else {
          const reason = declineReason || booking.decline_reason || '';
          const isCancelled = reason === 'Отменено администратором';
          const subjectText = isCancelled ? 'Бронирование отменено ❌' : 'Бронирование отклонено ❌';
          const headerText = isCancelled ? 'Ваше бронирование отменено' : 'Ваше бронирование отклонено';
          await sendEmail({
            to: booking.guest_email,
            subject: subjectText,
            html: `<h2>${headerText}</h2>
<p><b>Ресторан:</b> ${eName}${eAddr ? ', ' + eAddr : ''}</p>
<p><b>Стол:</b> ${eTable}</p>
<p><b>Время:</b> ${escapeHtml(formattedDate)}</p>
<p><b>Причина:</b> ${escapeHtml(reason || 'Ваше бронирование было отклонено.')}</p>`,
            text: `${headerText}\nРесторан: ${rest?.name || ''}${rest?.address ? ', ' + rest.address : ''}\nСтол: ${booking.table_label || 'Ожидает назначения'}\nВремя: ${formattedDate}\nПричина: ${reason || 'Ваше бронирование было отклонено.'}`,
          });
        }
      } catch (emailErr) { console.error('Email notification error (guest status):', emailErr); }
    }
    res.json(booking);
  } catch (error) { console.error('Update booking status error:', error); res.status(500).json({ error: 'Server error' }); }
});

// ============ PUBLIC BOOKING CANCELLATION ============

router.get('/public/bookings/cancel-info/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(`
      SELECT 
        b.id,
        b.guest_name as "guestName",
        b.guest_count as "guestCount",
        b.date_time as "dateTime",
        b.table_label as "tableLabel",
        b.status,
        r.name as "restaurantName"
      FROM bookings b
      JOIN restaurants r ON b.restaurant_id = r.id
      WHERE b.cancellation_token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Бронирование не найдено или ссылка недействительна' });
    }

    const booking = result.rows[0];
    const canCancel = booking.status === 'CONFIRMED' || booking.status === 'PENDING';

    res.json({
      bookingId: booking.id,
      restaurantName: booking.restaurantName,
      guestName: booking.guestName,
      guestCount: booking.guestCount,
      dateTime: booking.dateTime,
      tableLabel: booking.tableLabel,
      status: booking.status,
      canCancel: canCancel
    });
  } catch (error) {
    console.error('Get public cancel info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/public/bookings/cancel/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reason, comment } = req.body;

    if (!reason) return res.status(400).json({ error: 'Причина отмены обязательна' });
    if (reason === 'Other' && !comment?.trim()) {
      return res.status(400).json({ error: 'Пожалуйста, укажите причину в комментарии' });
    }

    const checkResult = await pool.query('SELECT id, status FROM bookings WHERE cancellation_token = $1', [token]);
    if (checkResult.rows.length === 0) return res.status(404).json({ error: 'Бронирование не найдено' });

    const booking = checkResult.rows[0];
    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') {
      return res.status(400).json({ error: 'Это бронирование нельзя отменить (текущий статус: ' + booking.status + ')' });
    }

    const result = await pool.query(`
      UPDATE bookings 
      SET 
        status = 'CANCELLED',
        cancel_reason = $1,
        cancel_comment = $2,
        cancelled_by = 'guest',
        cancelled_at = NOW()
      WHERE cancellation_token = $3
      RETURNING *
    `, [reason, comment || null, token]);

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Public cancel booking error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/bookings/cleanup-expired', async (req, res) => {
  try {
    const result = await pool.query(`UPDATE bookings SET status = 'DECLINED', decline_reason = 'Automatic cancellation' WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '1 hour' RETURNING *`);

    res.json({ updated: result.rows.length, bookings: result.rows });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admins', async (req, res) => {
  try {
    const { restaurantId, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO admins (restaurant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, restaurant_id, email', [restaurantId, email, passwordHash]);
    res.json(result.rows[0]);
  } catch (error) { if (error.code === '23505') return res.status(400).json({ error: 'Admin exists' }); res.status(500).json({ error: 'Server error' }); }
});

router.get('/restaurants/:restaurantId/admins', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const result = await pool.query('SELECT id, email, created_at FROM admins WHERE restaurant_id = $1', [restaurantId]);
    res.json(result.rows);
  } catch (error) { console.error('Get admins error:', error); res.status(500).json({ error: 'Server error' }); }
});

// ============ GUESTS ============

router.get('/guests/search', async (req, res) => {
  try {
    const { phone } = req.query;
    const result = await pool.query(`
      SELECT 
        phone, 
        name, 
        email, 
        internal_comment as "internalComment", 
        created_at as "createdAt", 
        updated_at as "updatedAt"
      FROM guests 
      WHERE phone != '' AND phone IS NOT NULL AND phone LIKE $1 
      ORDER BY updated_at DESC 
      LIMIT 20
    `, [`%${phone || ''}%`]);
    res.json(result.rows);
  } catch (error) {
    console.error('Search guests error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/guests/:phone/history', async (req, res) => {
  try {
    const { phone } = req.params;

    // Get stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(*) FILTER (WHERE status = 'DECLINED' AND decline_reason = 'Отменено администратором') as cancelled_by_admin,
        COUNT(*) FILTER (WHERE status = 'DECLINED' AND decline_reason != 'Отменено администратором') as declined,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled_by_guest,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed
      FROM bookings 
      WHERE guest_phone = $1
    `, [phone]);

    // Get history
    const historyResult = await pool.query(`
      SELECT 
        b.id,
        b.restaurant_id as "restaurantId",
        b.table_id as "tableId",
        b.table_label as "tableLabel",
        b.guest_name as "guestName",
        b.guest_phone as "guestPhone",
        b.guest_email as "guestEmail",
        b.guest_count as "guestCount",
        b.date_time as "dateTime",
        b.status,
        b.guest_comment as "guestComment",
        b.assigned_to as "assignedTo",
        b.decline_reason as "declineReason",
        b.cancel_reason as "cancelReason",
        b.cancel_comment as "cancelComment",
        b.created_at as "createdAt",
        r.name as "restaurantName" 
      FROM bookings b
      JOIN restaurants r ON b.restaurant_id = r.id
      WHERE b.guest_phone = $1 
      ORDER BY b.date_time DESC
    `, [phone]);

    res.json({
      stats: statsResult.rows[0],
      history: historyResult.rows
    });
  } catch (error) {
    console.error('Get guest history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/guests/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { internalComment, name, email } = req.body;
    const result = await pool.query(`
      UPDATE guests 
      SET internal_comment = $1, name = $2, email = $3, updated_at = CURRENT_TIMESTAMP
      WHERE phone = $4 
      RETURNING 
        phone, 
        name, 
        email, 
        internal_comment as "internalComment", 
        created_at as "createdAt", 
        updated_at as "updatedAt"
    `, [internalComment, name, email, phone]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update guest error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
