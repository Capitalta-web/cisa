// api/_lib/github.js
// Cliente mínimo de GitHub autenticado como GitHub App (JWT RS256 -> token de instalación).
// Sin dependencias; las llaves vienen SOLO de variables de entorno.
'use strict';
const crypto = require('crypto');

const API = 'https://api.github.com';

function cfg() {
  const appId = process.env.GITHUB_APP_ID;
  const key = String(process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const repo = process.env.GITHUB_REPO || 'abalderasdev/cisa';
  const base = process.env.GITHUB_BASE_BRANCH || 'main';
  if (!appId || !key.includes('PRIVATE KEY') || !installationId) {
    throw Object.assign(new Error('GitHub App no configurada (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID)'), { status: 500 });
  }
  return { appId, key, installationId, repo, base };
}

function appJwt({ appId, key }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 60, exp: now + 540, iss: String(appId) })}`;
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(key).toString('base64url');
  return `${data}.${sig}`;
}

async function gh(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cisa-editor',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error(`GitHub ${method} ${path}: ${r.status} ${json && json.message}`), { status: 502 });
  return json;
}

async function client() {
  const c = cfg();
  const { token } = await gh(appJwt(c), 'POST', `/app/installations/${c.installationId}/access_tokens`);
  const R = `/repos/${c.repo}`;
  return {
    base: c.base,
    repo: c.repo,
    async baseSha() { return (await gh(token, 'GET', `${R}/git/ref/heads/${c.base}`)).object.sha; },
    async listHtml(sha) {
      const t = await gh(token, 'GET', `${R}/git/trees/${sha}?recursive=1`);
      return t.tree.filter((e) => e.type === 'blob' && e.path.endsWith('.html')).map((e) => ({ path: e.path, sha: e.sha }));
    },
    async readBlob(sha) {
      const b = await gh(token, 'GET', `${R}/git/blobs/${sha}`);
      return Buffer.from(b.content, 'base64').toString('utf8');
    },
    // files: [{path, content}] -> rama nueva + commit + PR
    async openPr({ branch, files, message, title, body, parentSha }) {
      const parent = await gh(token, 'GET', `${R}/git/commits/${parentSha}`);
      const tree = await gh(token, 'POST', `${R}/git/trees`, {
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      });
      const commit = await gh(token, 'POST', `${R}/git/commits`, { message, tree: tree.sha, parents: [parentSha] });
      await gh(token, 'POST', `${R}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
      return gh(token, 'POST', `${R}/pulls`, { title, head: branch, base: c.base, body, draft: false });
    },
  };
}

module.exports = { client, appJwt };
