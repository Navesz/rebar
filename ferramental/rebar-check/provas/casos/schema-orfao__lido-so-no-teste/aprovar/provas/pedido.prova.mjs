import esquema from '../esquemas/pedido.schema.json' with { type: 'json' }
import { totalDeItens } from '../src/pedido.mjs'

if (!esquema.required.includes('itens')) throw new Error('contrato mudou')
if (totalDeItens({ itens: ['a', 'b'] }) !== 2) throw new Error('total errado')
