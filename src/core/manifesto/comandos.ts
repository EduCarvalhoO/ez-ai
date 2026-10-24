// Regras de `executar` e `comando` (D9; E7 do modelo de ameaças). É lista de bloqueio: nunca completa.
// O controle real é a aprovação humana do `plan` e o enforcement do ambiente (F4); ver a spec.

/** Programa e argumentos exatos que um componente roda ou pede para rodar. */
export interface Comando {
  readonly programa: string;
  readonly argumentos: readonly string[];
}

// Programas que rodam outro comando, baixam algo da rede ou trocam de usuário.
const PROGRAMAS_PROIBIDOS = new Set([
  'env',
  'xargs',
  'nohup',
  'nice',
  'timeout',
  'time',
  'sudo',
  'doas',
  'su',
  'runas',
  'busybox',
  'watch',
  'setsid',
  'stdbuf',
  'chroot',
  'start',
  'curl',
  'wget',
  'iwr',
  'irm',
  'invoke-webrequest',
  'invoke-restmethod',
  'certutil',
  'bitsadmin',
  'nc',
  'ncat',
  'netcat',
  'ssh',
  'scp',
  'docker',
  'podman',
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const POWERSHELL = new Set(['pwsh', 'powershell']);
const CMD = new Set(['cmd']);
// Interpretadores e as opções que recebem código no próprio argumento.
const CODIGO_INLINE: Readonly<Record<string, readonly string[]>> = {
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  bun: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  php: ['-r'],
  osascript: ['-e'],
};

// Executores que baixam e rodam um pacote: o pacote precisa de versão exata.
const EXECUTORES_DIRETOS = new Set(['npx', 'bunx', 'pnpx']);
const EXECUTORES_COM_SUBCOMANDO: Readonly<Record<string, readonly string[]>> = {
  npm: ['exec', 'x'],
  pnpm: ['dlx'],
  yarn: ['dlx'],
};
const EXECUTORES_PYTHON = new Set(['uvx']);
const EXECUTORES_PYTHON_COM_SUBCOMANDO: Readonly<Record<string, readonly string[]>> = { pipx: ['run'] };

const VERSAO_EXATA = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?';
const PACOTE_NPM_FIXO = new RegExp(`^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+@${VERSAO_EXATA}$`);
const PACOTE_PYTHON_FIXO = new RegExp(`^[A-Za-z0-9._-]+==${VERSAO_EXATA}$`);

function primeiroNaoOpcao(argumentos: readonly string[]): string | undefined {
  return argumentos.find((argumento) => !argumento.startsWith('-'));
}

/** Valores de `-p x`, `--package x` e `--package=x` do npx. */
function pacotesDeOpcao(argumentos: readonly string[]): string[] {
  const valores: string[] = [];
  argumentos.forEach((argumento, i) => {
    if (argumento.startsWith('--package=')) valores.push(argumento.slice('--package='.length));
    else if (argumento === '-p' || argumento === '--package') valores.push(argumentos[i + 1] ?? '');
  });
  return valores;
}

function problemaNoExecutor(programa: string, argumentos: readonly string[], fixo: RegExp): string | undefined {
  const alvos = [...pacotesDeOpcao(argumentos)];
  const semOpcoesDePacote = argumentos.filter(
    (argumento, i) =>
      !(
        argumento === '-p' ||
        argumento === '--package' ||
        argumentos[i - 1] === '-p' ||
        argumentos[i - 1] === '--package'
      ),
  );
  if (alvos.length === 0) alvos.push(primeiroNaoOpcao(semOpcoesDePacote) ?? '');
  const solto = alvos.find((alvo) => !fixo.test(alvo));
  if (solto === undefined) return undefined;
  return `"${programa}" roda "${solto || '(nada)'}" sem versão exata; fixe como nome@1.2.3 (sem @latest nem intervalo)`;
}

/** Confere um comando. Devolve o motivo da recusa, se houver. */
export function problemaNoComando(comando: Comando): string | undefined {
  const { argumentos } = comando;
  // No Windows, `bash.exe` e `bash` são o mesmo programa.
  const programa = comando.programa.replace(/\.(?:exe|cmd|bat|com)$/, '');
  if (PROGRAMAS_PROIBIDOS.has(programa)) {
    return `"${programa}" não é permitido: roda outro comando, baixa da rede ou troca de usuário`;
  }
  if (SHELLS.has(programa) && argumentos.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) || a === '--command')) {
    return `"${programa}" com código no argumento (-c); aponte para um script do pacote`;
  }
  if (POWERSHELL.has(programa) && argumentos.some((a) => /^[-/](?:c|e)/i.test(a))) {
    return `"${programa}" com -Command/-EncodedCommand; aponte para um script do pacote`;
  }
  if (CMD.has(programa) && argumentos.some((a) => /^\/[ckr]$/i.test(a))) {
    return `"${programa}" com /c, /k ou /r roda texto como comando; aponte para um script do pacote`;
  }
  const inline = CODIGO_INLINE[programa];
  if (
    inline &&
    argumentos.some((a) => inline.includes(a) || inline.some((o) => o.startsWith('--') && a.startsWith(`${o}=`)))
  ) {
    return `"${programa}" com código no argumento; aponte para um arquivo do pacote`;
  }
  if (EXECUTORES_DIRETOS.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_NPM_FIXO);
  if (EXECUTORES_PYTHON.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_PYTHON_FIXO);
  const [subcomando, ...resto] = argumentos;
  if (subcomando !== undefined && EXECUTORES_COM_SUBCOMANDO[programa]?.includes(subcomando)) {
    return problemaNoExecutor(`${programa} ${subcomando}`, resto, PACOTE_NPM_FIXO);
  }
  if (subcomando !== undefined && EXECUTORES_PYTHON_COM_SUBCOMANDO[programa]?.includes(subcomando)) {
    return problemaNoExecutor(`${programa} ${subcomando}`, resto, PACOTE_PYTHON_FIXO);
  }
  return undefined;
}
