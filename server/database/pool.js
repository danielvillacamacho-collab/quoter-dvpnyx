const { Pool } = require('pg');
require('dotenv').config();
const useSsl = ['true', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 20, idleTimeoutMillis: 30000
});
pool.on('error', (err) => console.error('Pool error:', err));
module.exports = pool;
