'use strict';

/*
Java-only reimplementation of the comrun/preload.sh protocol, for deployment
targets (like Railway) that don't allow the sudo-based comrunner OS-user
separation that the original bash comrun script relies on for sandboxing.

Protocol (unchanged from comrun/bin/comrun + preload.sh):

  Input: a zip containing a "script" file, an "in/" directory (stdin per run
  id), and source directories referenced by the script.

  script directives (only the Java-relevant ones are implemented; anything
  else is reported as an error in the corresponding _errors file):

    prepare dir srcdir srcdir ...
      Creates dir and copies the *contents* of each srcdir into it, in order.
      Missing srcdirs (e.g. "use" when a problem has no auxiliary jars) are
      silently skipped, matching the original `cp -R ... 2>/dev/null`.

    compile dir Java file1 file2 ...
      Runs javac in dir. Output (stdout+stderr) goes to out/dir/_compile on
      success, out/dir/_errors on failure (and any .class files are removed).

    run dir id timeoutSec maxOutputLen interleaveIO Java mainFile arg1 arg2 ...
      Runs `java <mainFile-without-.java> args...` in dir, stdin from
      in/<id>, output (stdout+stderr, truncated to maxOutputLen lines) to
      out/id/_run. interleaveIO is accepted but ignored: Java's
      echoesStdin() is NEVER, so codecheck never actually sets this true
      for Java.

    unittest dir timeoutSec Java mainFile dep1 dep2 ...
      Compiles mainFile + deps against the bundled JUnit4/Hamcrest jars,
      then runs org.junit.runner.JUnitCore against it. Output to
      out/dir/_compile|_errors and out/dir/_run.

    collect dir file1 file2 ...
      Copies file1, file2, ... (relative to dir, subdirectories preserved)
      into out/dir.

  Output: a zip of the out/ directory.
*/

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { findBlacklisted } = require('./blacklist');

const LIB_DIR = path.join(__dirname, '..', 'lib', 'jars'); // bundled junit/hamcrest, for unittest
const DEFAULT_MAX_LINES = 10000; // matches preload.sh's global $MAXOUTPUTLEN for compile/unittest
const COMPILE_TIMEOUT_MS = 20_000;

async function runJob(zipBuffer) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'comrun-java-'));
  try {
    new AdmZip(zipBuffer).extractAllTo(workDir, true);
    await fsp.mkdir(path.join(workDir, 'out'), { recursive: true });

    const scriptPath = path.join(workDir, 'script');
    const scriptText = await fsp.readFile(scriptPath, 'utf8').catch(() => '');
    const lines = scriptText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    for (const line of lines) {
      const tokens = line.split(/\s+/);
      const cmd = tokens[0];
      try {
        if (cmd === 'prepare') await doPrepare(workDir, tokens.slice(1));
        else if (cmd === 'compile') await doCompile(workDir, tokens.slice(1));
        else if (cmd === 'run') await doRun(workDir, tokens.slice(1));
        else if (cmd === 'unittest') await doUnittest(workDir, tokens.slice(1));
        else if (cmd === 'collect') await doCollect(workDir, tokens.slice(1));
        // 'debug' and 'process' directives: no-op (CheckStyle not supported)
      } catch (err) {
        // A single failing directive shouldn't abort the whole job; record
        // and continue so the report can show a sensible error.
        console.error(`comrun-java: directive failed: ${line}\n${err.stack || err}`);
      }
    }

    const outDir = path.join(workDir, 'out');
    const zip = new AdmZip();
    zip.addLocalFolder(outDir);
    return zip.toBuffer();
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function doPrepare(workDir, args) {
  const [dir, ...srcDirs] = args;
  const destDir = path.join(workDir, dir);
  await fsp.mkdir(destDir, { recursive: true });
  for (const srcDirName of srcDirs) {
    const srcDir = path.join(workDir, srcDirName);
    let entries;
    try {
      entries = await fsp.readdir(srcDir);
    } catch {
      continue; // missing source dir is fine, matches `2>/dev/null`
    }
    for (const entry of entries) {
      await fsp.cp(path.join(srcDir, entry), path.join(destDir, entry), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function doCompile(workDir, args) {
  const [dir, language, ...files] = args;
  const outDir = path.join(workDir, 'out', dir);
  await fsp.mkdir(outDir, { recursive: true });
  if (language !== 'Java') {
    await fsp.writeFile(path.join(outDir, '_errors'), `Unsupported language: ${language}\n`);
    return;
  }
  const cwd = path.join(workDir, dir);
  // Solution code is instructor-authored and trusted; only scan submission builds.
  if (!dir.startsWith('solution')) {
    const blocked = await checkBlacklist(cwd, files);
    if (blocked) {
      await fsp.writeFile(path.join(outDir, '_errors'), `'${blocked}' is not available in this environment.\n`);
      return;
    }
  }
  const { output, code } = await execCapture('javac', ['-cp', '.:use/*', ...files], cwd, {
    timeoutMs: COMPILE_TIMEOUT_MS,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (code === 0) {
    await fsp.writeFile(path.join(outDir, '_compile'), output);
  } else {
    await fsp.writeFile(path.join(outDir, '_errors'), output);
    await removeClassFiles(cwd);
  }
}

async function doRun(workDir, args) {
  const [dir, id, timeoutSec, maxOutputLen, /* interleaveIO */, language, mainFile, ...runArgs] = args;
  const outDir = path.join(workDir, 'out', id);
  await fsp.mkdir(outDir, { recursive: true });
  if (language !== 'Java') {
    await fsp.writeFile(path.join(outDir, '_run'), `Unsupported language: ${language}\n`);
    return;
  }
  const cwd = path.join(workDir, dir);
  const className = mainFile.replace(/\.java$/, '');
  const classFile = path.join(cwd, `${className}.class`);
  if (!fs.existsSync(classFile)) {
    await fsp.writeFile(path.join(outDir, '_run'), '');
    return;
  }
  const inputPath = path.join(workDir, 'in', id);
  const input = await fsp.readFile(inputPath, 'utf8').catch(() => '');
  const { output } = await execCapture(
    'java',
    [
      '-ea',
      '-Djava.awt.headless=true',
      '-Dcom.horstmann.codecheck',
      '-cp',
      '.:use/*',
      className,
      ...runArgs,
    ],
    cwd,
    {
      input,
      timeoutMs: Math.max(1, parseInt(timeoutSec, 10)) * 1000,
      maxLines: parseInt(maxOutputLen, 10) || DEFAULT_MAX_LINES,
    }
  );
  await fsp.writeFile(path.join(outDir, '_run'), output);
}

async function doUnittest(workDir, args) {
  const [dir, timeoutSec, language, mainFile, ...deps] = args;
  const dirPath = path.join(workDir, dir);
  await fsp.mkdir(dirPath, { recursive: true });
  const outDir = path.join(workDir, 'out', dir);
  await fsp.mkdir(outDir, { recursive: true });
  if (language !== 'Java') {
    await fsp.writeFile(path.join(outDir, '_errors'), `Unsupported language: ${language}\n`);
    return;
  }
  const blocked = await checkBlacklist(dirPath, [mainFile, ...deps]);
  if (blocked) {
    await fsp.writeFile(path.join(outDir, '_errors'), `'${blocked}' is not available in this environment.\n`);
    return;
  }
  const cp = `.:use/*:${LIB_DIR}/*`;
  const compileResult = await execCapture('javac', ['-cp', cp, mainFile, ...deps], dirPath, {
    timeoutMs: COMPILE_TIMEOUT_MS,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (compileResult.code !== 0) {
    await fsp.writeFile(path.join(outDir, '_errors'), compileResult.output);
    return;
  }
  const className = mainFile.replace(/\.java$/, '');
  const { output } = await execCapture(
    'java',
    ['-ea', '-Djava.awt.headless=true', '-cp', cp, 'org.junit.runner.JUnitCore', className],
    dirPath,
    { timeoutMs: Math.max(1, parseInt(timeoutSec, 10)) * 1000, maxLines: DEFAULT_MAX_LINES }
  );
  await fsp.writeFile(path.join(outDir, '_run'), output);
}

async function doCollect(workDir, args) {
  const [dir, ...files] = args;
  const srcDir = path.join(workDir, dir);
  const destDir = path.join(workDir, 'out', dir);
  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest).catch(() => {});
  }
}

async function checkBlacklist(cwd, files) {
  const contents = await Promise.all(
    files.map((f) => fsp.readFile(path.join(cwd, f), 'utf8').catch(() => ''))
  );
  return findBlacklisted(contents);
}

async function removeClassFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await removeClassFiles(p);
    else if (entry.name.endsWith('.class')) await fsp.rm(p, { force: true });
  }
}

function execCapture(cmd, cmdArgs, cwd, { input, timeoutMs, maxLines }) {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const child = spawn(cmd, cmdArgs, { cwd });

    const killTimer = setTimeout(() => {
      if (done) return;
      child.kill('SIGKILL');
      chunks.push(Buffer.from(`\nExecution stopped: exceeded the ${timeoutMs / 1000}-second time limit.\n`));
    }, timeoutMs);

    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));

    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      resolve({ output: `Server error running ${cmd}: ${err.message}\n`, code: 1 });
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      let output = Buffer.concat(chunks).toString('utf8');
      if (maxLines) {
        const lines = output.split('\n');
        if (lines.length > maxLines) output = lines.slice(0, maxLines).join('\n');
      }
      resolve({ output, code: code === null ? 1 : code });
    });

    if (input && child.stdin.writable) child.stdin.write(input);
    child.stdin.end();
  });
}

module.exports = { runJob };
