'use strict';

/*
comrun gateway for the GPU (numba-cuda / CuPy) CodeCheck instance.

Same wire protocol as comrun/bin/server.js — POST a job zip to /api/upload,
get the out/ zip back — but with a concurrency gate in front so a whole
class submitting at once can't spawn dozens of simultaneous CUDA contexts
and exhaust GPU memory. Excess requests queue; the queue is bounded and
each waiter times out rather than piling up forever.

The heavy lifting is still done by the stock /opt/codecheck/comrun bash
script + preload.sh (which already knows how to compile/run/unittest
Python); this file only adds the gate and reuses the original's stdout
parsing (comrun prints the output zip path as its second-to-last line).

The webapp's HTTP client (checker.Util.fileUpload) gives up after 90s, so
queue-wait + job-run must stay under that: the defaults below sum to 45+75
worst case but a real job is usually <60s total, and a client that does
time out just surfaces as a re-submittable checker error.

Tunables (all via environment):
  PORT                       listen port (default 8080)
  COMRUN_MAX_CONCURRENCY     jobs allowed to run at once (default 3)
  COMRUN_MAX_QUEUE           waiters allowed to queue (default 30)
  COMRUN_QUEUE_TIMEOUT_MS    how long a waiter waits before 503 (default 45000)
  COMRUN_JOB_TIMEOUT_MS      hard cap on a single comrun invocation (default 75000)
  COMRUN_SCRIPT              path to the comrun script (default /opt/codecheck/comrun)
*/

const http = require('http');
const fs = require('fs');
const { formidable } = require('formidable');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.COMRUN_MAX_CONCURRENCY || '3', 10));
const MAX_QUEUE = Math.max(0, parseInt(process.env.COMRUN_MAX_QUEUE || '30', 10));
const QUEUE_TIMEOUT_MS = parseInt(process.env.COMRUN_QUEUE_TIMEOUT_MS || '45000', 10);
const JOB_TIMEOUT_MS = parseInt(process.env.COMRUN_JOB_TIMEOUT_MS || '75000', 10);
const COMRUN_SCRIPT = process.env.COMRUN_SCRIPT || '/opt/codecheck/comrun';

// ── concurrency gate ────────────────────────────────────────────────────────
let active = 0;
const waiters = [];

function acquire() {
  return new Promise((resolve, reject) => {
    if (active < MAX_CONCURRENCY) {
      active++;
      resolve();
      return;
    }
    if (waiters.length >= MAX_QUEUE) {
      reject(Object.assign(new Error('Server busy: too many jobs queued. Try again in a moment.'), { code: 'QUEUE_FULL' }));
      return;
    }
    const entry = { resolve, reject };
    entry.timer = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      reject(Object.assign(new Error('Server busy: timed out waiting for a free slot. Try again.'), { code: 'QUEUE_TIMEOUT' }));
    }, QUEUE_TIMEOUT_MS);
    waiters.push(entry);
  });
}

function release() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(); // slot handed straight over; `active` stays unchanged
  } else {
    active--;
  }
}

// ── comrun invocation ───────────────────────────────────────────────────────
function runComrun(jobZipPath) {
  return new Promise((resolve, reject) => {
    execFile(
      COMRUN_SCRIPT,
      [jobZipPath],
      { timeout: JOB_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          reject(new Error(`comrun exceeded the ${JOB_TIMEOUT_MS / 1000}s job time limit`));
          return;
        }
        if (stderr && stderr.length) console.error('comrun stderr:', stderr);
        const lines = stdout.split('\n');
        // Everything before the last two lines is comrun's own logging.
        for (let i = 0; i < lines.length - 2; i++) if (lines[i]) console.log(lines[i]);
        const outZip = lines[lines.length - 2];
        if (!outZip || !fs.existsSync(outZip)) {
          reject(new Error('comrun did not produce an output zip'));
          return;
        }
        resolve(outZip);
      }
    );
  });
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', active, queued: waiters.length, maxConcurrency: MAX_CONCURRENCY }) + '\n');
    return;
  }

  if (req.url === '/api/upload' && req.method.toLowerCase() === 'post') {
    const form = formidable({ multiples: false, maxFileSize: 20 * 1024 * 1024 });
    form.parse(req, async (err, _fields, files) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad upload: ' + err.message);
        return;
      }
      const jobFile = Array.isArray(files.job) ? files.job[0] : files.job;
      if (!jobFile) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('No job file provided.');
        return;
      }
      const jobPath = jobFile.filepath || jobFile.path;

      let acquired = false;
      try {
        await acquire();
        acquired = true;
        const outZip = await runComrun(jobPath);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="out.zip"',
        });
        const stream = fs.createReadStream(outZip);
        stream.pipe(res);
        stream.on('close', () => fs.unlink(outZip, () => {}));
        stream.on('error', (e) => {
          console.error(e);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('comrun-gpu failed: ' + e.message);
          fs.unlink(outZip, () => {});
        });
      } catch (e) {
        const status = e.code === 'QUEUE_FULL' || e.code === 'QUEUE_TIMEOUT' ? 503 : 500;
        console.error(e);
        if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end('comrun-gpu: ' + e.message);
      } finally {
        if (acquired) release();
        fs.unlink(jobPath, () => {});
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <form action="/api/upload" enctype="multipart/form-data" method="post">
      <div>File: <input type="file" name="job"/></div>
      <input type="submit" value="Upload" />
    </form>
  `);
});

server.listen(PORT, () => {
  console.log(`comrun-gpu listening on http://localhost:${PORT}/  (max ${MAX_CONCURRENCY} concurrent, queue ${MAX_QUEUE})`);
});
