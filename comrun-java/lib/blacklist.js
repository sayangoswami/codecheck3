'use strict';

/*
Static source scan applied to compiled Java source before javac ever runs.
There's no OS-user/container separation on this deployment target, so this
is the only line of defense against a submission escaping its temp dir,
spawning processes, or hammering the shared container. Aimed at intro
programming courses: it does not block java.io/java.nio file APIs, since
some existing problems legitimately read/write files (see
samples/java/example5, samples/java/test2).
*/

const BLACKLIST = [
  { pattern: /\bRuntime\b/, label: 'Runtime' },
  { pattern: /\bProcessBuilder\b/, label: 'ProcessBuilder' },
  { pattern: /\bProcessHandle\b/, label: 'ProcessHandle' },
  { pattern: /\bSystem\s*\.\s*exit\b/, label: 'System.exit' },
  { pattern: /\bSystem\s*\.\s*getenv\b/, label: 'System.getenv' },
  { pattern: /\bThread\b/, label: 'Thread' },
  { pattern: /\bExecutorService\b/, label: 'ExecutorService' },
  { pattern: /\bForkJoinPool\b/, label: 'ForkJoinPool' },
  { pattern: /\bClassLoader\b/, label: 'ClassLoader' },
  { pattern: /\bjava\.net\b/, label: 'java.net (networking)' },
  { pattern: /\bjava\.lang\.reflect\b/, label: 'java.lang.reflect' },
  { pattern: /\bsun\.misc\b/, label: 'sun.misc' },
  { pattern: /\bjdk\.internal\b/, label: 'jdk.internal' },
];

// Returns the label of the first blacklisted API found in any file, or null.
function findBlacklisted(fileContents) {
  for (const content of fileContents) {
    for (const { pattern, label } of BLACKLIST) {
      if (pattern.test(content)) return label;
    }
  }
  return null;
}

module.exports = { findBlacklisted };
