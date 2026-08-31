from motor import montar_quadro


def test_checksum_de_oito_bits():
    assert montar_quadro(0x33, [0x01])[-1] == 0x35
