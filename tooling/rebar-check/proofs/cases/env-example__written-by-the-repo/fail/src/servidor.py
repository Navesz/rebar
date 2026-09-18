import os


def ambiente_do_filho(base):
    launch_env = dict(os.environ)
    # LE do ambiente de quem chamou: o valor tem de vir de fora, e por isso
    # precisa estar documentado.
    destino = launch_env["APP_STATE_DIR"]
    return os.path.join(base, destino)
