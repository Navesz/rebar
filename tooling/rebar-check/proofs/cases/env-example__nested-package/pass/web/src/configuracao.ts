// O Vite lê o env do diretório do PACOTE, não da raiz do repositório: uma
// VITE_ escrita no arquivo da raiz não chega ao build. Duas variáveis, e não
// uma, para que a comparação entre lido e documentado seja exercitada.
export const configuracao = {
  api: import.meta.env.VITE_API_BASE_URL as string,
  wss: import.meta.env.VITE_WSS_BASE_URL as string,
}
