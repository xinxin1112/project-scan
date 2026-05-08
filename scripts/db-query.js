#!/usr/bin/env node
const mysql = require('mysql2/promise');

const [,, host, port, user, password, database, sql] = process.argv;

if (!host || !sql) {
  console.error('Usage: db-query.js <host> <port> <user> <password> <database> <sql>');
  process.exit(1);
}

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port: parseInt(port),
      user,
      password,
      database,
      connectTimeout: 10000
    });
    const [rows] = await conn.execute(sql);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(`DB Error: ${err.message}`);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
})();
