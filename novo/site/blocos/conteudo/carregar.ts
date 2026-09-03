/**
 * O ponto único onde `site.json` vira dado tipado — e o ponto onde o build
 * morre se ele divergir do esquema.
 *
 * A validação roda no ESCOPO DO MÓDULO de propósito. `app/layout.tsx` importa
 * daqui, o `next build` avalia este módulo para pré-renderizar a rota, e um
 * campo faltando lança antes de qualquer HTML sair. É o que separa esquema de
 * decoração: decoração é o que só roda quando alguém lembra de chamar.
 */
import bruto from './site.json'
import { esquemaSite, type Site } from './esquema'

export const site: Site = esquemaSite(bruto, 'site')
export type { Site }
// `Contato` e `Whatsapp` saem por aqui porque quem renderiza importa DESTE
// arquivo, nunca do esquema: a porta é uma só. `Contato` é o que faz o mapa da
// home ser cobrado como total; `Whatsapp` é o bloco já estreitado que
// `linkWhatsapp` exige — sem ele o botão não compila sem tratar o `null`.
export type { Contato, Whatsapp } from './esquema'
export { linkWhatsapp } from './esquema'
