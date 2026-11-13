// Development: API server (port 3000, restarts on changes) + Vite UI with hot reload (port 5173).
//   bun run dev   ->  open http://localhost:5173
// Vite forwards /api and /login to the server.

const procs = [
  Bun.spawn(['bun', '--watch', 'src/server.ts'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev'], { cwd: 'web', stdout: 'inherit', stderr: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// If either one exits, stop the other too.
await Promise.race(procs.map((p) => p.exited));
stop();
