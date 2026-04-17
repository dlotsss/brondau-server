import pg from 'pg';
import dotenv from 'dotenv';

const { Pool, types } = pg;
dotenv.config();
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
const host = process.env.DB_HOST;
const port = process.env.DB_PORT;
const database = process.env.DB_NAME;
// Force TIMESTAMP (1114) to be interpreted as UTC string
types.setTypeParser(1114, (str) => str + 'Z');

const pool = new Pool({
  user: user,
  password: password,
  host: host,
  port: port,
  database: database,
  ssl: {
    rejectUnauthorized: false
  },
  max: 2, // Limit connections per instance for serverless
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Пул соединений должен всегда работать в UTC, чтобы TIMESTAMP без часового пояса
// интерпретировались и записывались корректно вне зависимости от настроек ОС сервера.
pool.on('connect', (client) => {
  client.query("SET timezone = 'UTC'").catch(err => console.error('Error setting timezone:', err));
});

export default pool;
