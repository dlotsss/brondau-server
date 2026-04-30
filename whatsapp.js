import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const API_TOKEN = process.env.GREEN_API_TOKEN;

export async function sendWhatsAppMessage(phone, text) {
  if (!INSTANCE_ID || !API_TOKEN) {
    console.log('[whatsapp] GREEN_API credentials not set');
    return;
  }
  
  // Clean phone: keep only digits
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) {
    console.log('[whatsapp] No valid phone number provided');
    return;
  }

  const chatId = `${cleanPhone}@c.us`;
  const url = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: text })
    });
    const data = await res.json();
    if (data && data.idMessage) {
      console.log(`[whatsapp] sent message to ${cleanPhone}`);
    } else {
      console.error(`[whatsapp] failed to send to ${cleanPhone}:`, data);
    }
    return data;
  } catch (err) {
    console.error('[whatsapp] fetch error:', err);
  }
}
