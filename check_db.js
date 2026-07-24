import Database from 'better-sqlite3';
const db = new Database('realintel.db');
console.log(db.prepare("SELECT * FROM settings").all());
