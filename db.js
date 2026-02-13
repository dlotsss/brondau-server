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
  }
});

export default pool;
