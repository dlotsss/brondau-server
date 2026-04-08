import fetch from 'node-fetch';
import pool from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============ CORE API ============

async function sendMessage(chatId, text, parseMode = 'HTML') {
  if (!BOT_TOKEN) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[telegram] sendMessage failed:', data.description);
    }
    return data;
  } catch (err) {
    console.error('[telegram] sendMessage error:', err);
  }
}

// ============ ADMIN NOTIFICATIONS ============

async function notifyRestaurantAdmins(restaurantId, text) {
  try {
    const result = await pool.query(
      'SELECT telegram_chat_id FROM admins WHERE restaurant_id = $1 AND telegram_chat_id IS NOT NULL',
      [restaurantId]
    );
    const chatIds = result.rows.map(r => r.telegram_chat_id).filter(Boolean);

    for (const chatId of chatIds) {
      await sendMessage(chatId, text);
    }

    if (chatIds.length > 0) {
      console.log(`[telegram] Notified ${chatIds.length} admin(s) for restaurant ${restaurantId}`);
    }
  } catch (err) {
    console.error('[telegram] notifyRestaurantAdmins error:', err);
  }
}

// ============ WEBHOOK COMMAND HANDLER ============

async function handleUpdate(update) {
  console.log('[telegram] Incoming update:', JSON.stringify(update));
  const message = update?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  // /start command
  if (text === '/start') {
    await sendMessage(chatId,
      '👋 Добро пожаловать в <b>Brondau Booking Bot</b>!\n\n' +
      'Этот бот отправляет уведомления о новых бронированиях и отменах.\n\n' +
      'Чтобы привязать аккаунт, введите:\n' +
      '<code>/link ваш@email.com</code>'
    );
    return;
  }

  // /link email command
  if (text.startsWith('/link ')) {
    const email = text.slice(6).trim().toLowerCase();

    if (!email || !email.includes('@')) {
      await sendMessage(chatId, '❌ Введите корректный email:\n<code>/link admin@example.com</code>');
      return;
    }

    try {
      // Check if admin exists with this email
      const adminResult = await pool.query(
        `SELECT a.id, a.email, a.restaurant_id, r.name as restaurant_name 
         FROM admins a 
         JOIN restaurants r ON r.id = a.restaurant_id 
         WHERE LOWER(a.email) = $1`,
        [email]
      );

      if (adminResult.rows.length === 0) {
        await sendMessage(chatId, '❌ Администратор с таким email не найден.\nПроверьте email и попробуйте снова.');
        return;
      }

      // Update all admin records with this email
      await pool.query(
        'UPDATE admins SET telegram_chat_id = $1 WHERE LOWER(email) = $2',
        [String(chatId), email]
      );

      const restaurants = adminResult.rows.map(r => r.restaurant_name).join(', ');
      await sendMessage(chatId,
        `✅ Аккаунт успешно привязан!\n\n` +
        `📧 Email: <b>${email}</b>\n` +
        `🍽 Рестораны: <b>${restaurants}</b>\n\n` +
        `Теперь вы будете получать уведомления о новых бронированиях и отменах.`
      );
    } catch (err) {
      console.error('[telegram] /link error:', err);
      await sendMessage(chatId, '⚠️ Ошибка при привязке. Попробуйте позже.');
    }
    return;
  }

  // /unlink command
  if (text === '/unlink') {
    try {
      const result = await pool.query(
        'UPDATE admins SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 RETURNING email',
        [String(chatId)]
      );
      if (result.rows.length > 0) {
        await sendMessage(chatId, '✅ Уведомления отключены. Ваш аккаунт отвязан.');
      } else {
        await sendMessage(chatId, 'ℹ️ Ваш Telegram не был привязан ни к одному аккаунту.');
      }
    } catch (err) {
      console.error('[telegram] /unlink error:', err);
      await sendMessage(chatId, '⚠️ Ошибка при отвязке. Попробуйте позже.');
    }
    return;
  }

  // Unknown command
  await sendMessage(chatId,
    'ℹ️ Доступные команды:\n' +
    '/start — начать\n' +
    '/link email — привязать аккаунт\n' +
    '/unlink — отвязать уведомления'
  );
}

// ============ WEBHOOK REGISTRATION ============

async function registerWebhook(baseUrl) {
  if (!BOT_TOKEN) {
    console.log('[telegram] No TELEGRAM_BOT_TOKEN — skipping webhook registration');
    return;
  }

  // Remove trailing slashes and ensure https://
  let cleanBase = baseUrl.trim();
  if (cleanBase.endsWith('/')) cleanBase = cleanBase.slice(0, -1);
  if (!cleanBase.startsWith('http')) cleanBase = 'https://' + cleanBase;

  const webhookUrl = `${cleanBase}/api/telegram/webhook`;

  try {
    const res = await fetch(`${API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[telegram] Webhook registered: ${webhookUrl}`);
    } else {
      console.error('[telegram] Webhook registration failed:', data.description);
    }
  } catch (err) {
    console.error('[telegram] registerWebhook error:', err);
  }
}

export { sendMessage, notifyRestaurantAdmins, handleUpdate, registerWebhook };
