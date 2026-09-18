import { strictEqual } from 'node:assert'

// O teste ENCENA o ambiente: escreve o valor que quer ver para poder afirmar
// alguma coisa. Isso não é o repositório FORNECENDO a variável — é o contrário,
// é o teste dizendo como quer que o ambiente de fora esteja.
process.env.AGENTE_SHELL = 'exec'
process.env.AGENTE_PLATAFORMA = 'telegram'

const { shell } = await import('../src/deteccao.mjs')
strictEqual(shell, 'exec')
