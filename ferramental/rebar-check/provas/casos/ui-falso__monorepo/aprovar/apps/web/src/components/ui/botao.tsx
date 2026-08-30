// Idêntico nos dois lados. A regra `ui-falso` não julga o conteúdo do
// componente: ela pergunta se a pasta que imita a convenção do shadcn tem, EM
// ALGUM DIRETÓRIO ACIMA DELA, o `components.json` que o CLI precisa.
export function Botao(props: { rotulo: string }) {
  return <button>{props.rotulo}</button>
}
