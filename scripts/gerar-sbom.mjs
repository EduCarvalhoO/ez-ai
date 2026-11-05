#!/usr/bin/env node
// SBOM (lista de componentes) do próprio ez-ai em CycloneDX 1.5, gerada do package-lock.json (ADR-0035).
// Determinística: sem data, sem UUID aleatório, sem rede. O número de série vem do hash do lockfile, então o mesmo
// lockfile gera sempre o mesmo SBOM e a verificação detecta qualquer desvio.
// Uso:
//   node scripts/gerar-sbom.mjs [saida]          (padrão: sbom.cdx.json)
//   node scripts/gerar-sbom.mjs --verificar <sbom.cdx.json>   (falha se o SBOM não corresponder ao lockfile atual)
// Código de saída: 0 ok, 1 SBOM divergente, 2 uso incorreto ou erro de leitura.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ version?: string, resolved?: string, integrity?: string, dev?: boolean, optional?: boolean, link?: boolean, license?: string }} EntradaDoLock
 * @typedef {{ name: string, version: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} Pacote
 */

/** `node_modules/@escopo/nome` (ou aninhado) -> `@escopo/nome`. */
function nomeDoCaminho(/** @type {string} */ caminho) {
  const i = caminho.lastIndexOf('node_modules/');
  return caminho.slice(i + 'node_modules/'.length);
}

function purl(/** @type {string} */ nome, /** @type {string} */ versao) {
  const codificado = nome.startsWith('@') ? `%40${nome.slice(1)}` : nome;
  return `pkg:npm/${codificado}@${versao}`;
}

/** `sha512-<base64>` -> `{ alg: 'SHA-512', content: <hex> }`. Formato desconhecido é omitido, nunca inventado. */
function hashDe(/** @type {string | undefined} */ integridade) {
  const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(integridade ?? '');
  if (!m) return undefined;
  const alg = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[
    /** @type {'sha512'} */ (m[1])
  ];
  return { alg, content: Buffer.from(/** @type {string} */ (m[2]), 'base64').toString('hex') };
}

/**
 * @param {string} textoDoLock conteúdo do package-lock.json
 * @param {string} textoDoPacote conteúdo do package.json
 */
export function gerarSbom(textoDoLock, textoDoPacote) {
  const lock = /** @type {{ lockfileVersion?: number, packages?: Record<string, EntradaDoLock> }} */ (
    JSON.parse(textoDoLock)
  );
  const pacote = /** @type {Pacote} */ (JSON.parse(textoDoPacote));
  if (!lock.packages || lock.lockfileVersion === undefined || lock.lockfileVersion < 2) {
    throw new Error('package-lock.json sem "packages" (lockfileVersion >= 2)');
  }
  const diretas = new Set([...Object.keys(pacote.dependencies ?? {}), ...Object.keys(pacote.devDependencies ?? {})]);
  const componentes = Object.entries(lock.packages)
    .filter(([caminho, e]) => caminho.startsWith('node_modules/') && e.version && !e.link)
    .map(([caminho, e]) => {
      const nome = nomeDoCaminho(caminho);
      const hash = hashDe(e.integrity);
      return {
        'bom-ref': `${purl(nome, /** @type {string} */ (e.version))}#${caminho}`,
        type: 'library',
        name: nome,
        version: e.version,
        purl: purl(nome, /** @type {string} */ (e.version)),
        scope: e.dev ? 'excluded' : e.optional ? 'optional' : 'required',
        ...(hash ? { hashes: [hash] } : {}),
        ...(e.license ? { licenses: [{ license: { id: e.license } }] } : {}),
        properties: [
          {
            name: 'harness:direta',
            value: String(!caminho.slice('node_modules/'.length).includes('node_modules/') && diretas.has(nome)),
          },
        ],
      };
    })
    .sort((a, b) => (a['bom-ref'] < b['bom-ref'] ? -1 : a['bom-ref'] > b['bom-ref'] ? 1 : 0));
  const serie = createHash('sha256').update(textoDoLock).digest('hex');
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${serie.slice(0, 8)}-${serie.slice(8, 12)}-${serie.slice(12, 16)}-${serie.slice(16, 20)}-${serie.slice(20, 32)}`,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: pacote.name,
        version: pacote.version,
        'bom-ref': `${pacote.name}@${pacote.version}`,
      },
      properties: [{ name: 'harness:lockfile-sha256', value: serie }],
    },
    components: componentes,
  };
}

export function serializarSbom(/** @type {unknown} */ sbom) {
  return `${JSON.stringify(sbom, null, 2)}\n`;
}

async function principal(/** @type {string[]} */ args) {
  if (args.includes('--help')) {
    console.log(
      'uso: node scripts/gerar-sbom.mjs [saida] | --verificar <sbom.cdx.json>\nGera o SBOM CycloneDX do package-lock.json (padrão: sbom.cdx.json) ou confere se um SBOM existente está em dia. Saída: 0 ok, 1 diverge, 2 uso incorreto ou erro de leitura.',
    );
    return 0;
  }
  const verificar = args[0] === '--verificar';
  if ((verificar && args.length !== 2) || (!verificar && args.length > 1)) {
    console.error('uso: node scripts/gerar-sbom.mjs [saida] | --verificar <sbom.cdx.json>');
    return 2;
  }
  try {
    const gerado = serializarSbom(
      gerarSbom(await readFile('package-lock.json', 'utf8'), await readFile('package.json', 'utf8')),
    );
    if (verificar) {
      const existente = await readFile(/** @type {string} */ (args[1]), 'utf8');
      if (existente === gerado) return 0;
      console.error('SBOM diverge do package-lock.json atual; gere de novo com "npm run sbom".');
      return 1;
    }
    await writeFile(args[0] ?? 'sbom.cdx.json', gerado);
    return 0;
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await principal(process.argv.slice(2));
}
