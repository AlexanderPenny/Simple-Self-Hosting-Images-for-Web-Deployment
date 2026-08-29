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

import { q } from '../src/db.js';

const username = process.argv[2];
const email = process.argv[3];

if (!username || !email) {
  console.error('Usage: npm run set-email -- <username> <email|-->');
  console.error('Pass -- as the email to remove SSO sign-in from that user.');
  process.exit(1);
}
if (!q.userByName.get(username)) {
  console.error(`No such user: ${username}`);
  process.exit(1);
}

if (email === '--') {
  q.setEmail.run(null, username);
  console.log(`Removed SSO email from "${username}". They can still sign in with a password.`);
  process.exit(0);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`"${email}" does not look like an email address.`);
  process.exit(1);
}
const existing = q.userByEmail.get(email);
if (existing && existing.username !== username) {
  console.error(`"${email}" is already used by "${existing.username}".`);
  process.exit(1);
}

q.setEmail.run(email, username);
console.log(`"${username}" can now sign in via SSO using ${email}.`);
