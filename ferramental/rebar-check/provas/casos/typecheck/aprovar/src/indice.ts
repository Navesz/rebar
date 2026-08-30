// O .ts existe para tirar a regra do estado nao-se-aplica: sem nenhum arquivo
// TypeScript rastreado ela devolve na('nao tem TypeScript') e sai 0 dos dois
// lados, o que faria o lado `reprovar` passar por engano.
export function somar(a: number, b: number): number {
  return a + b
}
