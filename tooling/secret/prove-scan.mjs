#!/usr/bin/env node
// As provas do varredor de segredo — por DETECÇÃO, não por execução.
//
// POR QUE ESTE ARQUIVO EXISTE, e é uma lição que custou um P1 de auditoria
// externa. O passo `secret` do portão é do tipo `comando:`, e a nota do
// `prove-steps.mjs` diz que passo assim "já se prova sozinho: se o script que
// ele chama sumir ou quebrar, o passo cai". Verdade, e insuficiente: prova que
// o varredor RODA, nunca que ele ACHA.
//
// O furo que passou por baixo disso: o mesmo token sintético em dois arquivos
// no índice, um UTF-8 e outro UTF-16LE com BOM. O primeiro foi achado, o
// segundo passou — exit 0, zero achados, e o arquivo ainda contado como
// "binário varrido", de modo que o silêncio parecia cobertura. O passo `secret`
// ficou verde a execução inteira.
//
// Cada teste aqui é uma detecção que tem de acontecer, ou um falso positivo que
// não pode acontecer. Nenhum usa credencial real: os tokens são sintéticos, com
// o prefixo do fornecedor e o comprimento certo, que é o que as regras leem.
//
// Uso:  node --test tooling/secret/prove-scan.mjs

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

const AQUI = dirname(fileURLToPath(import.meta.url))
const VARREDOR = join(AQUI, 'scan-secret.mjs')

// Token SINTÉTICO. Prefixo e comprimento são o que a regra `github-token` lê;
// o miolo é sequência de teclado, não credencial de ninguém.
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const LINHA = `$Token = "${TOKEN}"`

/**
 * Monta um repositório em miniatura, põe os arquivos no ÍNDICE e roda
 * `--staged`. Índice e não disco porque é assim que o hook chama, e porque a
 * própria auditoria anterior deste varredor achou o caso em que os dois
 * divergiam.
 */
async function comArquivos(arquivos) {
  const dir = await mkdtemp(join(tmpdir(), 'rebar-secret-'))
  try {
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
    git('init', '-q')
    git('config', 'user.email', 'prova@rebar.local')
    git('config', 'user.name', 'Prova')
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      const abs = join(dir, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, conteudo)
    }
    git('add', '-A')
    let saida = ''
    let codigo = 0
    try {
      saida = execFileSync(process.execPath, [VARREDOR, '--staged'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      })
    } catch (e) {
      saida = `${e.stdout ?? ''}${e.stderr ?? ''}`
      codigo = e.status ?? 1
    }
    return { saida, codigo }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('o varredor de segredo · codificação', { concurrency: 4 }, () => {
  test('ACHA · token em UTF-8', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from(LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token em UTF-8 passou limpo:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  // O CASO DO P1. Antes do conserto: exit 0, zero achados, e o arquivo contado
  // como binário varrido. Se `decodificar()` sumir, este teste volta a vermelho
  // e diz exatamente o que voltou a passar.
  test('ACHA · o MESMO token em UTF-16LE com BOM', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from('﻿' + LINHA, 'utf16le') })
    assert.notEqual(r.codigo, 0, `token em UTF-16LE passou limpo — é o P1 de volta:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('ACHA · o MESMO token em UTF-16BE com BOM', async () => {
    const bruto = Buffer.from('﻿' + LINHA, 'utf16le')
    bruto.swap16()
    const r = await comArquivos({ 'config.ps1': bruto })
    assert.notEqual(r.codigo, 0, `token em UTF-16BE passou limpo:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('ACHA · token em UTF-8 com BOM, e a coluna não desloca', async () => {
    const r = await comArquivos({ 'config.ts': Buffer.from('﻿' + LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token em UTF-8 com BOM passou limpo:\n${r.saida}`)
    // A coluna é a mesma do arquivo sem BOM: o BOM é consumido, não contado.
    assert.match(r.saida, /config\.ts:1:11/)
  })

  test('NÃO ACUSA · arquivo honesto, nas mesmas codificações', async () => {
    const limpo = '$Url = "https://api.github.com"\n$Retries = 3\n'
    const r = await comArquivos({
      'a.ps1': Buffer.from(limpo, 'utf8'),
      'b.ps1': Buffer.from('﻿' + limpo, 'utf16le'),
    })
    assert.equal(r.codigo, 0, `arquivo sem segredo foi acusado:\n${r.saida}`)
  })

  test('CONTA · binário de verdade continua indo pelo caminho de binário', async () => {
    // PNG mínimo: bytes NUL sem BOM. Não vira texto, e o relatório tem de
    // dizer que passou por ali — cobertura ausente que se declara é diferente
    // de cobertura fingida, que foi o defeito do UTF-16.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    const r = await comArquivos({ 'i.png': png })
    assert.match(r.saida, /binário\(s\)/)
  })
})
