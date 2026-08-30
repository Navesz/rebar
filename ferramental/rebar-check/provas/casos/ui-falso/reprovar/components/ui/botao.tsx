// Componente idêntico nos dois lados da prova. A regra `ui-falso` não julga o
// conteúdo do componente: ela pergunta se a pasta que imita a convenção do
// shadcn tem o `components.json` que o CLI precisa para achá-la.
export function Botao(props: { rotulo: string; aoClicar?: () => void }) {
  return <button onClick={props.aoClicar}>{props.rotulo}</button>
}
