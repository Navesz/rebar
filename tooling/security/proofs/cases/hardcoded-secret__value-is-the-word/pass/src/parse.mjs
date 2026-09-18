// O parser sob teste. Esta aqui para que a fixture ao lado seja uma fixture de
// alguma coisa, e nao uma folha solta.
export function parse(texto) {
  const saida = {}
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha)
    if (m) saida[m[1]] = m[2]
  }
  return saida
}
