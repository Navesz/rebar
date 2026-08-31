"""Leitura do endereco 0x33 da ECU."""


def montar_quadro(endereco, dados):
    corpo = [endereco, len(dados), *dados]
    return [*corpo, sum(corpo) & 0xFF]
