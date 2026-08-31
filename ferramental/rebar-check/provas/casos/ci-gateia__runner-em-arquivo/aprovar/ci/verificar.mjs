// O comando unico que o CI chama. O alvo que a regra procura esta AQUI, um
// arquivo abaixo do package.json.
import { spawnSync } from 'node:child_process'

const passos = [
  { nome: 'formato', comando: 'npm run --silent formato' },
  { nome: 'lint', comando: 'npm run --silent lint' },
]

for (const passo of passos) {
  const { status } = spawnSync(passo.comando, { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}
