'use strict';

const http = require('http');
const { formidable } = require('formidable');
const fs = require('fs');
const { runJob } = require('./lib/runner');
const { handleRunJava, setupWebSocket } = require('./lib/interactive');

const PORT = process.env.PORT || 8080;

// Shared per-IP rate limit across both the codecheck batch protocol
// (/api/upload) and the interactive routes (/run/java, /run/java/ws).
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const rec = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + RATE_WINDOW_MS;
  }
  rec.count++;
  rateLimitMap.set(ip, rec);
  return rec.count <= RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateLimitMap) if (now > rec.resetAt) rateLimitMap.delete(ip);
}, RATE_WINDOW_MS);

const server = http.createServer((req, res) => {
  // The interactive routes are called directly from browser JS (onlineIde /
  // Quarto pages hosted elsewhere); /api/upload is server-to-server from
  // codecheck-webapp and doesn't need this, but it's harmless there too.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/run/java' && req.method.toLowerCase() === 'post') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ segments: [], stderr: 'Rate limit reached — please wait a minute before running again.', exitCode: 1 }));
      return;
    }
    readJsonBody(req, 100 * 1024)
      .then((body) => handleRunJava(body, res))
      .catch((err) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ segments: [], stderr: 'Bad request: ' + err.message, exitCode: 1 }));
      });
    return;
  }

  if (req.url === '/api/upload' && req.method.toLowerCase() === 'post') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Rate limit reached, please wait a minute before submitting again.');
      return;
    }

    const form = formidable({ multiples: false, maxFileSize: 20 * 1024 * 1024 });
    form.parse(req, async (err, _fields, files) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad upload: ' + err.message);
        return;
      }
      try {
        const jobFile = Array.isArray(files.job) ? files.job[0] : files.job;
        if (!jobFile) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('No job file provided.');
          return;
        }
        const zipBuffer = await fs.promises.readFile(jobFile.filepath);
        const outZip = await runJob(zipBuffer);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="out.zip"',
        });
        res.end(outZip);
      } catch (e) {
        console.error(e);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('comrun-java failed: ' + e.message);
      } finally {
        const jobFile = Array.isArray(files.job) ? files.job[0] : files.job;
        if (jobFile) fs.promises.unlink(jobFile.filepath).catch(() => {});
      }
    });
    return;
  }

  // Matches the upload form served by comrun/bin/server.js, used as a smoke
  // test in build-instructions.md.
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <form action="/api/upload" enctype="multipart/form-data" method="post">
      <div>File: <input type="file" name="job"/></div>
      <input type="submit" value="Upload" />
    </form>
  `);
});

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

setupWebSocket(server, checkRateLimit);

server.listen(PORT, () => {
  console.log(`comrun-java listening on http://localhost:${PORT}/`);
});
