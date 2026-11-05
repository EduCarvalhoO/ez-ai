let d = '';
process.stdin
  .on('data', (c) => (d += c))
  .on('end', () => {
    let j = {};
    try {
      j = JSON.parse(d);
    } catch {}
    const c = j.tool_input?.command ?? '';
    if (/git push.*--force|rm -rf/.test(c)) {
      console.error('bloqueado pelo ez-ai: comando destrutivo');
      process.exit(2);
    }
    process.exit(0);
  });
