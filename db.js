import pg from 'pg';
import dotenv from 'dotenv';

const { Pool, types } = pg;
dotenv.config();

const user = isLocal ? 'brondau_user' : process.env.DB_USER;
const password = isLocal ? 'brondau_password' : process.env.DB_PASSWORD;
const host = isLocal ? 'localhost' : process.env.DB_HOST;
const port = isLocal ? 5432 : process.env.DB_PORT;
const database = isLocal ? 'brondau_local' : process.env.DB_NAME;

// Force TIMESTAMP (1114) to be interpreted as UTC string
types.setTypeParser(1114, (str) => str + 'Z');

const pool = new Pool({
  user: user,
  password: password,
  host: host,
  port: port,
  database: database,
  ssl: isLocal ? false : {
    rejectUnauthorized: false
  },
  max: isLocal ? 10 : 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export default pool;
