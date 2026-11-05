"""Static server for the site with path addresses (/prihodi, /razhodi/obrazovanie): the app in the browser, without the server part.

    python3 tools/site/serve.py              # site/ on http://127.0.0.1:8000/  (every unknown path gets the app shell)
    python3 tools/site/serve.py --port 8080 --dir some/folder

Every path without a file extension gets site/index.html, so the router builds the screen in the browser. The v6 checks (tools/mock/) run
the app this way. The host itself draws every screen on the server (docs/adr/0002-react-router-ssr.md): npm run build, then npx wrangler dev.
"""
import argparse
import functools
import http.server
import os
import pathlib
import posixpath
import re
import socketserver
import sys
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILE_EXT = re.compile(r'\.[A-Za-z][A-Za-z0-9]{0,4}$')     # as in site/js/loc.js: /vedomstvo/0200/0200.01.00 is a screen, not a file


class Handler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with path-address fallbacks"""

    shell = None          # bytes of the app shell for the development fallback (site/index.html); read at start

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _send_file(self, path, status=200, ctype='text/html; charset=utf-8'):
        body = pathlib.Path(path).read_bytes() if not isinstance(path, bytes) else path
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        return True                                          # answered: _route() tells do_GET not to send a second response

    def _resolve(self):
        """the file for the request path, or None. Order: the file itself, <path>.html, <path>/index.html"""
        raw = urllib.parse.urlsplit(self.path).path
        rel = posixpath.normpath(urllib.parse.unquote(raw)).lstrip('/')
        if rel in ('', '.'):
            rel = 'index.html'
        base = pathlib.Path(self.directory)
        for cand in (base / rel, base / (rel + '.html'), base / rel / 'index.html'):
            try:
                cand.resolve().relative_to(base.resolve())
            except ValueError:
                return None, raw
            if cand.is_file():
                return cand, raw
        return None, raw

    def _route(self):
        f, raw = self._resolve()
        if f is not None:
            if f.suffix == '.html' and f.name != pathlib.Path(urllib.parse.unquote(raw)).name:
                return self._send_file(f)                    # /prihodi -> prihodi.html (SimpleHTTPRequestHandler would 404)
            return None                                      # an ordinary file: let the base class serve it (ranges, types)
        has_ext = bool(FILE_EXT.search(raw)) and not raw.startswith('/embed/')   # /embed/prognoza.s13-deficit is a screen
        if has_ext:
            return None                                      # a missing file stays a 404 (the data loader reads a 404 as „предстои“)
        return self._send_file(self.shell)

    def do_GET(self):
        if self._route() is None:
            super().do_GET()

    def do_HEAD(self):
        if self._route() is None:
            super().do_HEAD()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionError, BrokenPipeError)):     # a browser that drops a request it no longer needs is not an error
            super().handle_error(request, client_address)


def start(directory, port=0, shell=None):
    """start a threaded server in the background; returns (server, base_url)"""
    directory = str(pathlib.Path(directory).resolve())
    H = type('H', (Handler,), {'shell': shell if shell is not None else (pathlib.Path(directory) / 'index.html').read_bytes()})
    srv = Server(('127.0.0.1', port), functools.partial(H, directory=directory))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--dir', help='folder to serve (default site/)')
    ap.add_argument('--port', type=int, default=8000)
    a = ap.parse_args()
    d = pathlib.Path(a.dir) if a.dir else ROOT / 'site'
    if not (d / 'index.html').is_file():
        sys.exit(f'{d}/index.html not found')
    srv, url = start(d, a.port)
    print(f'serving {d} on {url}  (Ctrl+C to stop)')
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == '__main__':
    os.chdir(ROOT)
    main()
