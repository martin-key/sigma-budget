"""Run a build with network access denied and only guarded Python subprocesses."""
import runpy
import sys
from pathlib import Path


def guarded_python(executable, argv):
    """Every child must install this same guard before executing a module."""
    if not isinstance(argv, (list, tuple)) or len(argv) < 4:
        return False
    interpreter = Path(sys.executable).resolve()
    return (Path(executable).resolve() == interpreter
            and Path(argv[0]).resolve() == interpreter
            and list(argv[1:3]) == ["-m", "budget_pipeline.offline"])


def deny_network(event, args):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
        raise RuntimeError("network disabled during build: " + event)
    if event == "subprocess.Popen" and not guarded_python(args[0], args[1]):
        raise RuntimeError("build subprocess must use guarded Python")
    if event in ("os.system", "os.exec", "os.posix_spawn", "os.spawn", "pty.spawn"):
        raise RuntimeError("process launch disabled during build: " + event)


def main():
    module = sys.argv.pop(1)
    sys.addaudithook(deny_network)
    runpy.run_module(module, run_name="__main__")


if __name__ == "__main__":
    main()
