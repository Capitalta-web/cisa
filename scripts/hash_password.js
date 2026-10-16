#!/usr/bin/env node
// Genera la entrada de EDITOR_USERS para un usuario, localmente.
//   npm run hash-password -- alberto
// Pide la contraseña sin mostrarla (dos veces) e imprime "alberto:scrypt$...".
// La contraseña nunca sale de tu computadora; solo se copia el hash a Vercel.
'use strict';
const readline = require('readline');
const { hashPassword } = require('../api/_lib/session');

const user = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9._-]{2,40}$/.test(user)) {
  console.error('Uso: npm run hash-password -- <usuario>   (2-40 caracteres: a-z 0-9 . _ -)');
  process.exit(1);
}

function ask(q) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { // permite: printf 'clave\nclave\n' | npm run hash-password -- u
      const rl = readline.createInterface({ input: process.stdin });
      const lines = []; rl.on('line', (l) => lines.push(l)); rl.on('close', () => resolve(lines));
      return;
    }
    process.stdout.write(q);
    const stdin = process.stdin; let s = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (ch) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); resolve(s); }
      else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f') s = s.slice(0, -1);
      else s += ch;
    };
    stdin.on('data', on);
  });
}

(async () => {
  let a, b;
  if (process.stdin.isTTY) { a = await ask('Contraseña: '); b = await ask('Repite la contraseña: '); }
  else { [a, b] = await ask(); }
  if (a !== b) { console.error('No coinciden.'); process.exit(1); }
  if (!a || a.length < 12) { console.error('Usa al menos 12 caracteres.'); process.exit(1); }
  console.log(`\n${user}:${hashPassword(a)}\n`);
  console.error('Pega esa línea en EDITOR_USERS (Vercel, Sensitive). Varios usuarios: sepáralos con coma.');
})();
