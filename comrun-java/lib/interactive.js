'use strict';

/*
Ported from onlineIde/java-coderunner's server.js: ad-hoc interactive Java
compile/run for a standalone code editor (not the codecheck grading
protocol implemented in runner.js). Kept separate from runner.js because
the shapes are unrelated (JSON/WebSocket segments vs. the comrun zip
protocol), but shares the blacklist in blacklist.js so there's one set of
rules for what submitted Java code may do on this shared, unsandboxed
container.
*/

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { findBlacklisted } = require('./blacklist');

function checkBlacklist(code) {
  return findBlacklisted([code]);
}

function extractClassName(code) {
  const m = code.match(/public\s+class\s+(\w+)/);
  return m ? m[1] : null;
}

function runCmd(cmd, args, cwd, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const proc = execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 512 * 1024 },
      (err, stdout, stderr) => {
        let errText = stderr || '';
        if (err) {
          if (err.killed || err.signal === 'SIGTERM')
            errText = `Execution stopped: program exceeded the ${timeoutMs / 1000}-second time limit.`;
          else if (!errText && err.message) errText = err.message;
        }
        resolve({ stdout: stdout || '', stderr: errText, exitCode: err ? err.code ?? 1 : 0 });
      }
    );
    if (stdin && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

function runInteractive(tmpDir, className, stdinText, timeoutMs) {
  return new Promise((resolve) => {
    const lines = stdinText ? stdinText.split('\n') : [];
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    let li = 0,
      segments = [],
      stderr = '',
      done = false,
      timer = null;
    const proc = spawn('java', ['-cp', tmpDir, '-Xmx128m', '-Xss512k', className], { cwd: tmpDir });

    const finish = (exitCode) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      clearTimeout(timer);
      resolve({ segments, stderr: stderr.trimEnd(), exitCode });
    };

    const killTimer = setTimeout(() => {
      proc.kill('SIGTERM');
      stderr += `\nExecution stopped: program exceeded the ${timeoutMs / 1000}-second time limit.`;
      finish(1);
    }, timeoutMs);

    const writeNext = () => {
      if (li >= lines.length) {
        proc.stdin.end();
        return;
      }
      if (!proc.stdin.writable) return;
      const line = lines[li++];
      segments.push({ type: 'stdin', text: line + '\n' });
      proc.stdin.write(line + '\n');
    };

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (segments.length && segments[segments.length - 1].type === 'stdout')
        segments[segments.length - 1].text += text;
      else segments.push({ type: 'stdout', text });
      clearTimeout(timer);
      if (li < lines.length) timer = setTimeout(writeNext, 50);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => finish(code ?? 0));
    proc.on('error', (err) => {
      stderr += err.message;
      finish(1);
    });

    if (lines.length > 0) timer = setTimeout(writeNext, 150);
  });
}

// body: parsed JSON { code, stdin } for POST /run/java
async function handleRunJava(body, res) {
  const { code, stdin = '' } = body || {};

  if (!code || typeof code !== 'string') {
    respond(res, 400, { segments: [], stderr: 'No code provided.', exitCode: 1 });
    return;
  }

  const className = extractClassName(code);
  if (!className) {
    respond(res, 200, {
      segments: [],
      stderr: [
        'Compile error: no public class found.',
        'Your code must declare a public class, e.g.:',
        '',
        '  public class Hello {',
        '      public static void main(String[] args) {',
        '          System.out.println("Hello!");',
        '      }',
        '  }',
      ].join('\n'),
      exitCode: 1,
    });
    return;
  }

  const blocked = checkBlacklist(code);
  if (blocked) {
    respond(res, 200, { segments: [], stderr: `'${blocked}' is not available in this environment.`, exitCode: 1 });
    return;
  }

  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-'));
    fs.writeFileSync(path.join(tmpDir, `${className}.java`), code, 'utf8');

    const compile = await runCmd('javac', [path.join(tmpDir, `${className}.java`)], tmpDir, '', 10_000);
    if (compile.exitCode !== 0) {
      respond(res, 200, {
        segments: [],
        stderr: compile.stderr.split(tmpDir + path.sep).join(''),
        exitCode: compile.exitCode,
      });
      return;
    }

    const run = await runInteractive(tmpDir, className, stdin, 5_000);
    respond(res, 200, run);
  } catch (err) {
    respond(res, 500, { segments: [], stderr: 'Server error: ' + err.message, exitCode: 1 });
  } finally {
    if (tmpDir)
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
  }
}

function respond(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function setupWebSocket(httpServer, checkRateLimit) {
  const wss = new WebSocketServer({ server: httpServer, path: '/run/java/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';

    if (checkRateLimit && !checkRateLimit(ip)) {
      ws.send(JSON.stringify({ type: 'stderr', text: 'Rate limit reached — please wait a minute.' }));
      ws.send(JSON.stringify({ type: 'done', exitCode: 1 }));
      ws.close();
      return;
    }

    let proc = null,
      tmpDir = null,
      done = false,
      killTimer = null;

    const send = (obj) => {
      if (ws.readyState === ws.OPEN)
        try {
          ws.send(JSON.stringify(obj));
        } catch (_) {}
    };

    const finish = (exitCode) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      send({ type: 'done', exitCode });
      ws.close();
      if (tmpDir)
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
    };

    ws.on('message', async (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (_) {
        return;
      }

      if (msg.type === 'run') {
        const code = (msg.code || '').trim();
        if (!code) {
          finish(1);
          return;
        }

        const blocked = checkBlacklist(code);
        if (blocked) {
          send({ type: 'stderr', text: `'${blocked}' is not available in this environment.` });
          finish(1);
          return;
        }

        const className = extractClassName(code) || 'Main';

        try {
          tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-'));
          fs.writeFileSync(path.join(tmpDir, `${className}.java`), code, 'utf8');

          send({ type: 'status', text: 'compiling' });
          const compile = await runCmd('javac', [path.join(tmpDir, `${className}.java`)], tmpDir, '', 10_000);
          if (compile.exitCode !== 0) {
            send({ type: 'stderr', text: compile.stderr.split(tmpDir + path.sep).join('') });
            finish(compile.exitCode);
            return;
          }

          send({ type: 'status', text: 'running' });
          proc = spawn('java', ['-cp', tmpDir, '-Xmx128m', '-Xss512k', className], { cwd: tmpDir });

          killTimer = setTimeout(() => {
            if (!done) {
              proc.kill('SIGTERM');
              send({ type: 'stderr', text: '\nExecution stopped: 2-minute time limit exceeded.' });
              finish(1);
            }
          }, 120_000);

          proc.stdout.on('data', (chunk) => {
            if (!done) send({ type: 'stdout', text: chunk.toString() });
          });
          proc.stderr.on('data', (chunk) => {
            if (!done) send({ type: 'stderr', text: chunk.toString() });
          });
          proc.on('close', (code) => finish(code ?? 0));
          proc.on('error', (err) => {
            send({ type: 'stderr', text: err.message });
            finish(1);
          });
        } catch (err) {
          send({ type: 'stderr', text: 'Server error: ' + err.message });
          finish(1);
        }
      } else if (msg.type === 'stdin') {
        if (proc && proc.stdin.writable) proc.stdin.write(msg.text);
      }
    });

    ws.on('close', () => {
      clearTimeout(killTimer);
      if (proc && !done) {
        done = true;
        proc.kill('SIGTERM');
      }
      if (tmpDir)
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
    });

    ws.on('error', () => {
      clearTimeout(killTimer);
      if (proc && !done) {
        done = true;
        proc.kill('SIGTERM');
      }
    });
  });
}

module.exports = { handleRunJava, setupWebSocket };
