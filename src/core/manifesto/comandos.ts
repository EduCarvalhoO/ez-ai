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
  'wsl',
  'awk',
  'gawk',
  'mawk',
  'nawk',
  'mshta',
  'wscript',
  'cscript',
  'rundll32',
  'regsvr32',
  'msiexec',
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const POWERSHELL = new Set(['pwsh', 'powershell']);
const CMD = new Set(['cmd']);
// Interpretadores e as opções curtas (sozinhas ou combinadas, como `-pe`) ou longas que recebem código no argumento.
const CODIGO_INLINE: Readonly<Record<string, { readonly curtas: RegExp; readonly longas: readonly string[] }>> = {
  node: { curtas: /^-[A-Za-z]*[ep][A-Za-z]*$/, longas: ['--eval', '--print'] },
  bun: { curtas: /^-[A-Za-z]*[ep][A-Za-z]*$/, longas: ['--eval', '--print'] },
  deno: { curtas: /^eval$/, longas: [] },
  python: { curtas: /^-[A-Za-z]*c[A-Za-z]*$/, longas: [] },
  ruby: { curtas: /^-[A-Za-z]*e[A-Za-z]*$/, longas: [] },
  perl: { curtas: /^-[A-Za-z]*[eE][A-Za-z]*$/, longas: [] },
  php: { curtas: /^-[A-Za-z]*r[A-Za-z]*$/, longas: ['--run'] },
  osascript: { curtas: /^-[A-Za-z]*e[A-Za-z]*$/, longas: [] },
};

// Executores que baixam e rodam um pacote: o pacote precisa de versão exata.
const EXECUTORES_DIRETOS = new Set(['npx', 'bunx', 'pnpx']);
const EXECUTORES_COM_SUBCOMANDO: Readonly<Record<string, readonly string[]>> = {
  npm: ['exec', 'x', 'init', 'create'],
  pnpm: ['dlx', 'create'],
  yarn: ['dlx', 'create'],
  bun: ['x', 'create'],
};
const EXECUTORES_PYTHON = new Set(['uvx']);
const EXECUTORES_PYTHON_COM_SUBCOMANDO: Readonly<Record<string, readonly string[]>> = { pipx: ['run'], uv: ['tool'] };
// Opções de executor que trocam de onde o pacote vem ou acrescentam outro pacote.
const OPCOES_DE_ORIGEM =
  /^--(?:from|with|with-requirements|registry|index|index-url|extra-index-url|spec|pip-args|userconfig)(?:=|$)/;

const VERSAO_EXATA = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?';
const PACOTE_NPM_FIXO = new RegExp(`^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+@${VERSAO_EXATA}$`);
const PACOTE_PYTHON_FIXO = new RegExp(`^[A-Za-z0-9._-]+==${VERSAO_EXATA}$`);

/** Valores de `-p x`, `--package x` e `--package=x`. */
function pacotesDeOpcao(argumentos: readonly string[]): string[] {
  const valores: string[] = [];
  argumentos.forEach((argumento, i) => {
    if (argumento.startsWith('--package=')) valores.push(argumento.slice('--package='.length));
    else if (argumento === '-p' || argumento === '--package') valores.push(argumentos[i + 1] ?? '');
  });
  return valores;
}

function problemaNoExecutor(programa: string, argumentos: readonly string[], fixo: RegExp): string | undefined {
  const origem = argumentos.find((argumento) => OPCOES_DE_ORIGEM.test(argumento));
  if (origem) return `"${programa}" com "${origem}" troca a origem do pacote; não é permitido`;
  if (argumentos.some((a) => a === '-c' || a === '--call' || a.startsWith('--call='))) {
    return `"${programa}" com -c/--call roda texto num shell; não é permitido`;
  }
  const alvos = pacotesDeOpcao(argumentos);
  const posicionais = argumentos.filter(
    (a, i) => !a.startsWith('-') && argumentos[i - 1] !== '-p' && argumentos[i - 1] !== '--package',
  );
  if (alvos.length === 0) alvos.push(posicionais[0] ?? '');
  const solto = alvos.find((alvo) => !fixo.test(alvo));
  if (solto !== undefined) {
    return `"${programa}" roda "${solto || '(nada)'}" sem versão exata; fixe como nome@1.2.3 (sem @latest nem intervalo)`;
  }
  // Com -p, o primeiro posicional é o binário a rodar (pode ser `sh`): passa pelas mesmas regras.
  const binario = pacotesDeOpcao(argumentos).length > 0 ? posicionais[0] : undefined;
  if (binario === undefined) return undefined;
  return problemaNoComando({ programa: binario, argumentos: argumentos.slice(argumentos.indexOf(binario) + 1) });
}

/** `-Command`, `-EncodedCommand` e `-CommandWithArgs` aceitam qualquer abreviação (`-c`, `-enc`); `-ExecutionPolicy` não é código. */
function opcaoDeCodigoDoPowershell(argumento: string): boolean {
  if (!/^[-/][A-Za-z]+$/.test(argumento)) return false;
  const nome = argumento.slice(1).toLowerCase();
  return (
    ['command', 'encodedcommand', 'commandwithargs'].some((o) => o.startsWith(nome)) || nome === 'ec' || nome === 'cwa'
  );
}

/** Nome canônico: `bash.exe` → `bash`, `python3.12` → `python`, `nodejs` → `node`. */
function nomeCanonico(programa: string): string {
  const semExtensao = programa.replace(/\.(?:exe|cmd|bat|com)$/, '');
  if (/^python[0-9.]*$/.test(semExtensao) || semExtensao === 'py') return 'python';
  if (semExtensao === 'nodejs') return 'node';
  return semExtensao;
}

/** Confere um comando. Devolve o motivo da recusa, se houver. */
export function problemaNoComando(comando: Comando): string | undefined {
  const { argumentos } = comando;
  const programa = nomeCanonico(comando.programa);
  if (PROGRAMAS_PROIBIDOS.has(programa)) {
    return `"${programa}" não é permitido: roda outro comando, baixa da rede ou troca de usuário`;
  }
  if (
    SHELLS.has(programa) &&
    argumentos.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) || a === '--command' || a.startsWith('--command='))
  ) {
    return `"${programa}" com código no argumento (-c); aponte para um script do pacote`;
  }
  if (POWERSHELL.has(programa) && argumentos.some(opcaoDeCodigoDoPowershell)) {
    return `"${programa}" com -Command/-EncodedCommand; aponte para um script do pacote`;
  }
  if (CMD.has(programa) && argumentos.some((a) => /^\/[ckr]/i.test(a))) {
    return `"${programa}" com /c, /k ou /r roda texto como comando; aponte para um script do pacote`;
  }
  const inline = CODIGO_INLINE[programa];
  if (inline) {
    if (argumentos.some((a) => inline.curtas.test(a) || inline.longas.some((o) => a === o || a.startsWith(`${o}=`)))) {
      return `"${programa}" com código no argumento; aponte para um arquivo do pacote`;
    }
    if (argumentos.some((a) => /^(?:https?:|npm:|jsr:|data:)/i.test(a) || /=(?:https?:|data:)/i.test(a))) {
      return `"${programa}" com código remoto no argumento; inclua o arquivo no pacote`;
    }
  }
  if (programa === 'git' && argumentos.some((a) => a === '-c' || a.startsWith('--config-env'))) {
    return '"git -c" muda a configuração (ex.: alias que roda shell); não é permitido';
  }
  if (programa === 'find' && argumentos.some((a) => /^-(?:exec|execdir|ok|okdir)$/.test(a))) {
    return '"find -exec" roda outro comando; não é permitido';
  }
  // `pnpm exec` e `yarn exec` rodam um binário local: o comando que vem depois passa pelas mesmas regras.
  if ((programa === 'pnpm' || programa === 'yarn') && argumentos.includes('exec')) {
    const depois = argumentos.slice(argumentos.indexOf('exec') + 1);
    const i = depois.findIndex((a) => !a.startsWith('-'));
    const binario = depois[i];
    if (binario !== undefined) {
      const interno = problemaNoComando({ programa: binario, argumentos: depois.slice(i + 1) });
      if (interno) return interno;
    }
  }
  if (EXECUTORES_DIRETOS.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_NPM_FIXO);
  if (EXECUTORES_PYTHON.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_PYTHON_FIXO);
  // O subcomando pode vir depois de opções (`npm --yes exec x`): procura em qualquer posição.
  for (const [tabela, fixo] of [
    [EXECUTORES_COM_SUBCOMANDO, PACOTE_NPM_FIXO],
    [EXECUTORES_PYTHON_COM_SUBCOMANDO, PACOTE_PYTHON_FIXO],
  ] as const) {
    const subcomandos = tabela[programa];
    const i = subcomandos ? argumentos.findIndex((a) => subcomandos.includes(a)) : -1;
    if (i >= 0) {
      // `uv tool run x` / `uv tool install x`: o pacote vem depois do segundo subcomando.
      const inicio = programa === 'uv' ? argumentos.findIndex((a, j) => j > i && (a === 'run' || a === 'install')) : i;
      if (inicio < 0) continue;
      return problemaNoExecutor(
        `${programa} ${argumentos.slice(i, inicio + 1).join(' ')}`,
        argumentos.slice(inicio + 1),
        fixo,
      );
    }
  }
  return undefined;
}
