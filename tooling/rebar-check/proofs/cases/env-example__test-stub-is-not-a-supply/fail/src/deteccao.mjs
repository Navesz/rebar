// Quem fornece AGENTE_SHELL é o agente que este programa detecta, de fora. O
// repositório só lê. Duas variáveis, e não uma, para a comparação entre lido e
// documentado ser exercitada.
export const shell = process.env.AGENTE_SHELL
export const plataforma = process.env.AGENTE_PLATAFORMA
