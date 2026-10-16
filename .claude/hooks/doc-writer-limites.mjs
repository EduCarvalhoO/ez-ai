#!/usr/bin/env node
// Hook PreToolUse (registrado em .claude/settings.json) que limita o agente doc-writer:
// - Bash: só os três scripts das skills de documentação, um por vez, com argumentos simples;
// - Edit/Write: só arquivos dentro de docs/.
// Lê o JSON do Claude Code na entrada padrão; código 2 bloqueia e devolve o motivo ao agente.
// Outros agentes e a sessão principal passam direto (sai 0).
import { relative, resolve } from 'node:path';

// Comando inteiro, token a token: aspas simples, aspas duplas sem $ ` \ ! ou palavra simples.
// Separador só espaço/tab (quebra de linha encadearia comandos no shell).
const PERMITIDO =
  /^node[ \t]+(\.\/)?\.claude\/skills\/(localizar-documento\/buscar|novo-documento\/novo|validar-docs\/validar)\.mjs([ \t]+('[^']*'|"[^"$`\\!]*"|[\p{L}\p{N}._,:=\/+-]+))*[ \t]*$/u;
const ESCRITA = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function bloquear(msg) {
  console.error(`doc-writer: ${msg}`);
  process.exit(2);
}

let entrada = '';
process.stdin.on('data', (c) => (entrada += c));
process.stdin.on('end', () => {
  let dados;
  try {
    dados = JSON.parse(entrada);
  } catch {
    bloquear('entrada inesperada do hook; operação bloqueada por segurança.');
  }
  if (dados?.agent_type !== 'doc-writer') process.exit(0);

  if (dados.tool_name === 'Bash') {
    if (PERMITIDO.test(dados.tool_input?.command || '')) process.exit(0);
    bloquear(
      'o terminal só roda os scripts das skills (buscar.mjs, novo.mjs, validar.mjs), um por vez, a partir da raiz. ' +
        'Para ler ou procurar arquivos use Read, Grep ou Glob; para alterar, Edit ou Write.'
    );
  }

  if (ESCRITA.has(dados.tool_name)) {
    const raiz = resolve(process.env.CLAUDE_PROJECT_DIR || dados.cwd || process.cwd());
    const alvo = resolve(raiz, dados.tool_input?.file_path || dados.tool_input?.notebook_path || '');
    // relative() devolve ".." para fora de docs/ e caminho absoluto se for outro disco.
    const r = relative(resolve(raiz, 'docs'), alvo);
    if (r && !r.startsWith('..') && !/^([a-z]:|[\\/])/i.test(r)) process.exit(0);
    bloquear('só pode criar ou alterar arquivos dentro de docs/.');
  }

  process.exit(0);
});
