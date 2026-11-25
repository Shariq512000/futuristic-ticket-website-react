// Create an admin account, or reset an existing admin's password.
//
//   npm run create-admin -- --email you@example.com --name "Your Name"
//
// The password is asked for in the terminal (hidden), or read from the
// ADMIN_PASSWORD environment variable when set. Resetting a password also
// signs that admin out of all existing sessions.
import readline from 'node:readline';
import mongoose from 'mongoose';
import { Admin } from './models.js';
import { hashPassword } from './auth.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/match-tickets';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = (s) => {
      if (rl.stdoutMuted && s !== '\r\n' && s !== '\n') rl.output.write('*');
      else rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

async function main() {
  const email = (arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = arg('name') || process.env.ADMIN_NAME || 'Admin';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Pass a valid --email');

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) throw new Error('Set ADMIN_PASSWORD or run this in a terminal to be asked for it');
    password = await askHidden('Password (min 10 characters): ');
    const again = await askHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match');
  }
  if (password.length < 10) throw new Error('Password must be at least 10 characters');

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const passwordHash = await hashPassword(password);
  const existing = await Admin.findOne({ email });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.name = name;
    existing.sessionVersion += 1;
    await existing.save();
    console.log(`Updated admin ${email} (password changed, old sessions signed out)`);
  } else {
    await Admin.create({ email, name, passwordHash });
    console.log(`Created admin ${email}`);
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
