/**
 * Image generator — a real PNG, written with nothing but Node built-ins.
 *
 * WHY PNG AND NOT `og.jpg`, which was the name asked for. Writing a JPEG
 * encoder by hand (DCT, quantization, Huffman) to produce a rectangle of color
 * is big, fragile work, and the lazy alternative is worse: writing bytes that
 * are not JPEG into a file named `.jpg`. Some preview scrapers sniff the
 * content, not the extension, and the result would be exactly the failure §12.3
 * exists not to repeat — the build passes, the file exists, and the preview
 * comes out broken IN SILENCE.
 *
 * PNG solves it with no lie at all: `zlib.deflateSync` is built in, the format
 * is signature + IHDR + IDAT + IEND with CRC32, and WhatsApp, Facebook,
 * LinkedIn, Slack, Discord and Twitter accept `image/png` in `og:image` with no
 * caveat. So the file emitted is `public/og.png`, and `conteudo/site.json`
 * points at it. Zero dependency, and what comes out is an image that opens.
 *
 * What it draws is a REAL CARD, not a gray placeholder: background in the
 * content's theme color, a highlight bar, and the business name written with a
 * 5×7 bitmap font embedded down below. It is replaceable — and it should be
 * replaced by real art —, but until it is, the link preview shows the business
 * name instead of nothing.
 */
import { deflateSync } from 'node:zlib'

// ── PNG ───────────────────────────────────────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pedaco(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados])
  const tamanho = Buffer.alloc(4)
  tamanho.writeUInt32BE(dados.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo), 0)
  return Buffer.concat([tamanho, corpo, crc])
}

/** `rgb` is a Buffer of largura*altura*3, with no filter byte. */
export function png(largura, altura, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0)
  ihdr.writeUInt32BE(altura, 4)
  ihdr[8] = 8 // 8 bits per channel
  ihdr[9] = 2 // truecolor RGB
  // Filter 0 on every row: the image is flat areas, deflate already handles it.
  const linhas = Buffer.alloc(altura * (1 + largura * 3))
  for (let y = 0; y < altura; y++) {
    const destino = y * (1 + largura * 3)
    linhas[destino] = 0
    rgb.copy(linhas, destino + 1, y * largura * 3, (y + 1) * largura * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ])
}

// ── 5×7 bitmap font ───────────────────────────────────────────────────────
// Uppercase, digits and a handful of punctuation only. Accents are stripped
// before drawing: a generated card is not final typography, it is what keeps
// the preview from coming up empty.

const FONTE = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '11111 00100 00100 00100 00100 00100 11111',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '&': '01100 10010 10010 01100 10101 10010 01101',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
}

const ACENTOS = /[̀-ͯ]/g

/** Strips accents and falls back to what the font has. `SAO PAULO`, not `SÃO`. */
function normalizar(texto) {
  const semAcento = texto.normalize('NFD').replace(ACENTOS, '').toUpperCase()
  return [...semAcento]
    .map((c) => (c in FONTE ? c : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function hexParaRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function tela(largura, altura, cor) {
  const rgb = Buffer.alloc(largura * altura * 3)
  for (let i = 0; i < largura * altura; i++) {
    rgb[i * 3] = cor[0]
    rgb[i * 3 + 1] = cor[1]
    rgb[i * 3 + 2] = cor[2]
  }
  return rgb
}

function retangulo(rgb, largura, x0, y0, w, h, cor) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * largura + x) * 3
      rgb[i] = cor[0]
      rgb[i + 1] = cor[1]
      rgb[i + 2] = cor[2]
    }
  }
}

function larguraDoTexto(texto, escala) {
  return texto.length ? texto.length * 6 * escala - escala : 0
}

function escrever(rgb, largura, texto, x0, y0, escala, cor) {
  let x = x0
  for (const caractere of texto) {
    const linhas = FONTE[caractere].split(' ')
    for (let ly = 0; ly < 7; ly++) {
      for (let lx = 0; lx < 5; lx++) {
        if (linhas[ly][lx] === '1') {
          retangulo(rgb, largura, x + lx * escala, y0 + ly * escala, escala, escala, cor)
        }
      }
    }
    x += 6 * escala
  }
}

/** Largest scale that fits the text in the box, within the given bounds. */
function escalaQueCabe(texto, larguraMaxima, min, max) {
  for (let escala = max; escala > min; escala--) {
    if (larguraDoTexto(texto, escala) <= larguraMaxima) return escala
  }
  return min
}

// ── the images ────────────────────────────────────────────────────────────

const LARGURA_OG = 1200
const ALTURA_OG = 630

export function cartaoOg({ nome, dominio, corTema, corFundo }) {
  const fundo = hexParaRgb(corTema)
  const tinta = hexParaRgb(corFundo)
  const rgb = tela(LARGURA_OG, ALTURA_OG, fundo)

  // Highlight bar on the left: it gives the card an axis and proves, at a
  // glance, that the image was generated — instead of being a 404 drawn as a
  // gray box.
  retangulo(rgb, LARGURA_OG, 96, 150, 12, 330, tinta)

  const titulo = normalizar(nome).slice(0, 28)
  const escalaTitulo = escalaQueCabe(titulo, 900, 6, 22)
  escrever(rgb, LARGURA_OG, titulo, 152, 250, escalaTitulo, tinta)

  const rodape = normalizar(dominio).slice(0, 42)
  const escalaRodape = escalaQueCabe(rodape, 900, 3, 8)
  escrever(rgb, LARGURA_OG, rodape, 152, 250 + escalaTitulo * 7 + 48, escalaRodape, tinta)

  return png(LARGURA_OG, ALTURA_OG, rgb)
}

export function icone(tamanho, { nome, corTema, corFundo }) {
  const fundo = hexParaRgb(corTema)
  const tinta = hexParaRgb(corFundo)
  const rgb = tela(tamanho, tamanho, fundo)
  // One or two initials. More than that turns into a smudge at favicon size.
  const iniciais = normalizar(nome)
    .split(' ')
    .map((parte) => parte[0])
    .join('')
    .slice(0, 2)
  const escala = escalaQueCabe(iniciais, tamanho * 0.6, 2, Math.floor(tamanho / 12))
  const x = Math.round((tamanho - larguraDoTexto(iniciais, escala)) / 2)
  const y = Math.round((tamanho - 7 * escala) / 2)
  escrever(rgb, tamanho, iniciais, x, y, escala, tinta)
  return png(tamanho, tamanho, rgb)
}
