import readline from 'node:readline/promises';
import { q } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run passwd -- <username>');
  process.exit(1);
}
if (!q.userByName.get(username)) {
  console.error(`No such user: ${username}`);
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question(`New password for ${username}: `);
rl.close();
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
q.updatePassword.run(hashPassword(password), username);
console.log(`Password updated for "${username}".`);
process.exit(0);
