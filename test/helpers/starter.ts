import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Manifesto, validarManifesto } from '../../src/core/index.js';

const PASTA = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures', 'starter');

function ler(pasta: string, prefixo: string, saida: Record<string, string>): void {
  for (const d of readdirSync(pasta, { withFileTypes: true })) {
    const relativo = prefixo === '' ? d.name : `${prefixo}/${d.name}`;
    if (d.isDirectory()) ler(join(pasta, d.name), relativo, saida);
    else saida[relativo] = readFileSync(join(pasta, d.name), 'utf8');
  }
}

/** Arquivos do pacote starter (fixture oficial da F3), por caminho relativo ao pacote. */
export function arquivosDoStarter(): Record<string, string> {
  const saida: Record<string, string> = {};
  ler(PASTA, '', saida);
  return saida;
}

export function manifestoDoStarter(extra: (m: Record<string, unknown>) => void = () => {}): {
  manifesto: Manifesto;
  arquivos: Map<string, string>;
} {
  const arquivos = new Map(Object.entries(arquivosDoStarter()));
  const bruto = JSON.parse(arquivos.get('harness-package.json') ?? '{}') as Record<string, unknown>;
  extra(bruto);
  arquivos.set('harness-package.json', JSON.stringify(bruto));
  const r = validarManifesto(arquivos.get('harness-package.json') ?? '');
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return { manifesto: r.valor, arquivos };
}
