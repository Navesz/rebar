// A PALETA VEM DO CSS, LIDA E NÃO REDIGITADA. O valor #9aa3ad está citado aqui
// só para dizer QUAL cor é a `--tinta-suave` — quem pinta é a folha de estilo,
// e uma nota sobre a cor não diverge do token porque não é desenhada.
import { readFileSync } from 'node:fs'

export const paleta = lerPaleta(readFileSync('estilos.css', 'utf8'))

// As duas frases abaixo carregam os delimitadores de bloco do CSS partidos em
// strings diferentes, de propósito: quem trocar `semComentario` por um par de
// regex apaga tudo que está entre elas.
export const ajuda = 'em CSS um comentário abre com /*'
export const fecha = 'e fecha com */'

function lerPaleta(css) {
  return Object.fromEntries([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]))
}
