// Copyright 2026 Alexander L. Penny
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import readline from 'node:readline';
import { q } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run adduser -- <username>');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
  console.error('Usernames may use letters, numbers, dot, underscore and hyphen (2-64 chars).');
  process.exit(1);
}
if (q.userByName.get(username)) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

const password = await prompt(`Password for ${username}: `);
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
const again = await prompt('Repeat password: ');
if (password !== again) {
  console.error('Passwords did not match.');
  process.exit(1);
}

q.insertUser.run(username, hashPassword(password), Date.now());
console.log(`Created user "${username}".`);
process.exit(0);

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const onData = (char) => {
      if (['\n', '\r', '\u0004'].includes(String(char))) process.stdin.removeListener('data', onData);
      else rl.output.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => { rl.output.write('\n'); rl.close(); resolve(answer); });
  });
}
