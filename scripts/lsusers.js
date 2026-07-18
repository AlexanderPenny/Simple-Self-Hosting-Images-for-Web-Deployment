import { q } from '../src/db.js';
const rows = q.listUsers.all();
if (!rows.length) console.log('No users yet. Create one with: npm run adduser -- <username>');
for (const u of rows) {
  console.log(`${String(u.id).padStart(3)}  ${u.username.padEnd(24)} created ${new Date(u.created_at).toISOString().slice(0,10)}${u.disabled ? '  [disabled]' : ''}`);
}
process.exit(0);
