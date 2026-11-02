// Plataforma: implementa as portas de src/core/portas com Node (node:fs, git via processo).
// Única camada que faz I/O em nome do núcleo (ADR-0015).
export { criarArquivos } from './arquivos.js';
