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
