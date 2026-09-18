import os


def ambiente_do_filho(base):
    launch_env = dict(os.environ)
    # ESCREVE no ambiente do processo filho que este repositorio mesmo lanca.
    launch_env["APP_STATE_DIR"] = os.path.join(base, "estado")
    return launch_env
