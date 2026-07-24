import Database from 'better-sqlite3';

const db = new Database('realintel.db');
const settingsRows = db.prepare("SELECT * FROM settings").all();
const settingsMap = settingsRows.reduce((acc, curr) => {
  acc[curr.key] = curr.value;
  return acc;
}, {});

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(settingsMap.supabaseUrl, settingsMap.supabaseKey);

async function run() {
  const { data, error } = await supabase.from('projects').select('id').limit(1);
  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }
}
run();
