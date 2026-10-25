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
  'vi',
  'vim',
  'nvim',
  'emacs',
  'rsync',
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const POWERSHELL = new Set(['pwsh', 'powershell']);
const CMD = new Set(['cmd']);
// Interpretadores e as opções curtas (sozinhas ou combinadas, como `-pe`) ou longas que recebem código no argumento.
const CODIGO_INLINE: Readonly<Record<string, { readonly curtas: RegExp; readonly longas: readonly string[] }>> = {
  node: { curtas: /^-[A-Za-z]*[ep][A-Za-z]*$/, longas: ['--eval', '--print'] },
  bun: { curtas: /^-[A-Za-z]*[ep][A-Za-z]*$/, longas: ['--eval', '--print'] },
  deno: { curtas: /^(?:eval|x)$/, longas: [] },
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

function problemaNoExecutor(
  programa: string,
  argumentos: readonly string[],
  fixo: RegExp,
  aninhado: boolean,
): string | undefined {
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
  // Com -p, o binário que roda depois (pode ser `sh`) passa pelas mesmas regras.
  if (pacotesDeOpcao(argumentos).length === 0) return undefined;
  return aninhado ? EXECUTOR_ANINHADO : problemaEmQualquerJanela(argumentos);
}

/** `-Command`, `-EncodedCommand` e `-CommandWithArgs` aceitam qualquer abreviação (`-c`, `-enc`); `-ExecutionPolicy` não é código. */
function opcaoDeCodigoDoPowershell(argumento: string): boolean {
  if (!/^(?:--?|\/)[A-Za-z]+$/.test(argumento)) return false;
  const nome = argumento.replace(/^(?:--?|\/)/, '').toLowerCase();
  return (
    ['command', 'encodedcommand', 'commandwithargs'].some((o) => o.startsWith(nome)) || nome === 'ec' || nome === 'cwa'
  );
}

// Um executor dentro de outro faria a varredura de janelas crescer exponencialmente (D1): recusado.
const EXECUTOR_ANINHADO = 'executor de pacote dentro de outro executor não é permitido; rode o binário direto';

/**
 * Confere como comando cada trecho que começa num argumento que não é opção. Não dá para saber quais opções
 * recebem valor (`--cache .c bash -lc ...`), então toda posição candidata a binário é conferida (conservador).
 */
function problemaEmQualquerJanela(argumentos: readonly string[]): string | undefined {
  for (let k = 0; k < argumentos.length; k++) {
    const programa = argumentos[k];
    if (programa === undefined || programa.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(programa)) continue;
    const problema = problemaNoComando({ programa: programa.toLowerCase(), argumentos: argumentos.slice(k + 1) }, true);
    if (problema) return problema;
  }
  return undefined;
}

// Instaladores: baixam pacote e podem rodar script de instalação, então só com versão exata.
const INSTALADORES: Readonly<
  Record<string, { readonly subcomandos: readonly string[]; readonly fixo: 'npm' | 'python' }>
> = {
  npm: { subcomandos: ['install', 'i', 'in', 'ins', 'add', 'isntall'], fixo: 'npm' },
  pnpm: { subcomandos: ['add', 'install', 'i'], fixo: 'npm' },
  yarn: { subcomandos: ['add'], fixo: 'npm' },
  bun: { subcomandos: ['add', 'install', 'i'], fixo: 'npm' },
  pip: { subcomandos: ['install'], fixo: 'python' },
  pip3: { subcomandos: ['install'], fixo: 'python' },
  uv: { subcomandos: ['add', 'pip'], fixo: 'python' },
};

/**
 * Módulo de `python -m mod`, inclusive grudado (`-mpip`) ou depois de opções curtas combinadas (`-Im pip`).
 * Devolve o módulo e os argumentos que vêm depois dele.
 */
export function moduloDoPython(argumentos: readonly string[]): { modulo: string; resto: string[] } | undefined {
  for (let k = 0; k < argumentos.length; k++) {
    const partes = /^-[A-Za-z]*?m(.*)$/.exec(argumentos[k] ?? '');
    if (!partes) continue;
    const grudado = partes[1] ?? '';
    if (grudado !== '') return { modulo: grudado, resto: argumentos.slice(k + 1) };
    const modulo = argumentos[k + 1];
    return modulo === undefined ? undefined : { modulo, resto: argumentos.slice(k + 2) };
  }
  return undefined;
}

function problemaNoInstalador(programa: string, argumentos: readonly string[], aninhado: boolean): string | undefined {
  // `python -m pip install x` (ou `-mpip`, `-Im pip`) instala como `pip install x`.
  const doPython = programa === 'python' ? moduloDoPython(argumentos) : undefined;
  if (doPython) {
    const modulo = nomeCanonico(doPython.modulo.toLowerCase());
    if (modulo === 'pip' || modulo === 'pipx')
      return problemaNoComando({ programa: modulo, argumentos: doPython.resto }, aninhado);
  }
  if (programa === 'uv' && argumentos.includes('run') && argumentos.some((a) => OPCOES_DE_ORIGEM.test(a))) {
    return '"uv run" com --with/--from baixa pacote sem passar pelas regras; não é permitido';
  }
  const regra = INSTALADORES[programa];
  const i = regra ? argumentos.findIndex((a) => regra.subcomandos.includes(a)) : -1;
  if (!regra || i < 0) return undefined;
  const resto = argumentos.slice(programa === 'uv' && argumentos[i] === 'pip' ? i + 2 : i + 1);
  const origem = resto.find((a) => OPCOES_DE_ORIGEM.test(a));
  if (origem) return `"${programa}" com "${origem}" troca a origem do pacote; não é permitido`;
  const fixo = regra.fixo === 'npm' ? PACOTE_NPM_FIXO : PACOTE_PYTHON_FIXO;
  const solto = resto.find((a) => !a.startsWith('-') && !fixo.test(a));
  if (solto === undefined) return undefined;
  return `"${programa} ${argumentos[i]}" instala "${solto}" sem versão exata; fixe a versão (sem @latest nem intervalo)`;
}

/** Nome canônico: `bash.exe` → `bash`, `python3.12` → `python`, `nodejs` → `node`. */
export function nomeCanonico(programa: string): string {
  const semExtensao = programa.replace(/\.(?:exe|cmd|bat|com)$/, '');
  if (/^python[0-9.]*$/.test(semExtensao) || semExtensao === 'py') return 'python';
  if (semExtensao === 'nodejs') return 'node';
  if (/^pip[0-9.]*$/.test(semExtensao)) return 'pip';
  return semExtensao;
}

/** Confere um comando. Devolve o motivo da recusa, se houver. */
export function problemaNoComando(comando: Comando, aninhado = false): string | undefined {
  const { argumentos } = comando;
  const programa = nomeCanonico(comando.programa);
  // `corepack pnpm dlx x` roda o gerenciador indicado: confere o comando de dentro.
  if (programa === 'corepack') {
    const k = argumentos.findIndex((a) => !a.startsWith('-'));
    const interno = argumentos[k];
    if (interno !== undefined && /^(?:npm|npx|pnpm|pnpx|yarn)(?:@.*)?$/.test(interno)) {
      if (aninhado) return EXECUTOR_ANINHADO;
      return problemaNoComando({ programa: interno.replace(/@.*$/, ''), argumentos: argumentos.slice(k + 1) }, true);
    }
  }
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
  if (programa === 'git' && argumentos.some((a) => a === '-c' || a === 'config' || a.startsWith('--config-env'))) {
    return '"git -c" e "git config" mudam a configuração (ex.: alias ou fsmonitor que roda shell); não é permitido';
  }
  if (
    programa === 'git' &&
    (argumentos.includes('foreach') || argumentos.some((a) => a === '-x' || a.startsWith('--exec')))
  ) {
    return '"git submodule foreach" e "git rebase --exec" rodam texto como comando; não é permitido';
  }
  if (programa === 'go' && argumentos.some((a) => a === 'run' || a === 'install')) {
    const solto = argumentos.find((a) => a.includes('@') && !/@v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(a));
    if (solto) return `"go" roda "${solto}" sem versão exata; fixe como modulo@v1.2.3`;
  }
  if (programa === 'cargo' && argumentos.includes('install')) {
    if (
      argumentos.some((a) => /^--(?:git|path|registry|index)(?:=|$)/.test(a)) ||
      !argumentos.some((a) => a === '--version' || a.startsWith('--version='))
    ) {
      return '"cargo install" precisa de --version exata e não pode usar --git, --path, --registry nem --index';
    }
  }
  if (
    programa === 'tar' &&
    argumentos.some(
      (a) =>
        /^--(?:to-command|use-compress-program|checkpoint-action|info-script|new-volume-script)/.test(a) ||
        /^-[A-Za-z]*I/.test(a),
    )
  ) {
    return '"tar" com opção que roda outro programa; não é permitido';
  }
  const instalador = problemaNoInstalador(programa, argumentos, aninhado);
  if (instalador) return instalador;
  if (programa === 'find' && argumentos.some((a) => /^-(?:exec|execdir|ok|okdir)$/.test(a))) {
    return '"find -exec" roda outro comando; não é permitido';
  }
  // `pnpm exec` e `yarn exec` rodam um binário local: o comando que vem depois passa pelas mesmas regras.
  if ((programa === 'pnpm' || programa === 'yarn') && argumentos.includes('exec')) {
    if (aninhado) return EXECUTOR_ANINHADO;
    const interno = problemaEmQualquerJanela(argumentos.slice(argumentos.indexOf('exec') + 1));
    if (interno) return interno;
  }
  if (EXECUTORES_DIRETOS.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_NPM_FIXO, aninhado);
  if (EXECUTORES_PYTHON.has(programa)) return problemaNoExecutor(programa, argumentos, PACOTE_PYTHON_FIXO, aninhado);
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
        aninhado,
      );
    }
  }
  return undefined;
}
