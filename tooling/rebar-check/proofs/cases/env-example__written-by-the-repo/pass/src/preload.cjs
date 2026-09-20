'use strict'

const os = require('node:os')
// Lê o que o processo PAI escreveu no ambiente deste filho. Ninguém preenche
// isso: quem fornece o valor é o próprio repositório, uma linha acima.
const raiz = process.env.APP_STATE_DIR

if (raiz) {
  os.homedir = () => raiz
}
