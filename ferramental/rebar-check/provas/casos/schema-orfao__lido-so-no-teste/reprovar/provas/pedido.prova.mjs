import { totalDeItens } from '../src/pedido.mjs'

// O mesmo teste do lado aprovar, sem o import do schema: agora nenhum leitor
// resta, e o schema esta orfao de verdade.
if (totalDeItens({ itens: ['a', 'b'] }) !== 2) throw new Error('total errado')
