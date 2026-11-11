"""Built-Worker cross-origin CORS and framing regression checks (loopback only)."""
import argparse
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    base = args.url.rstrip('/')
    parsed = urlsplit(base)
    assert parsed.hostname == '127.0.0.1', 'loopback Worker required'
    class Consumer(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<html><body>Consumer</body></html>')
        def log_message(self, *args):
            pass
    server = HTTPServer(('127.0.0.1', parsed.port + 2), Consumer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    parent = f'http://127.0.0.1:{parsed.port + 2}/security-consumer' 
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(service_workers='block')
        page = context.new_page()
        page.goto(parent)
        results = page.evaluate('''async base => {
          const results = [];
          for (const path of ['/data/core.json', '/api/releases?limit=1.5']) {
            const response = await fetch(base + path, {credentials: 'omit'});
            results.push({path, status: response.status, json: await response.json()});
          }
          const frame = document.createElement('iframe');
          frame.src = base + '/embed/selftest'; document.body.append(frame);
          return results;
        }''', base)
        assert results[0]['status'] == 200, results
        assert results[1]['status'] == 400 and 'error' in results[1]['json'], results
        page.wait_for_function("document.querySelector('iframe') !== null")
        frame = page.frame(url=base + '/embed/selftest')
        for _ in range(100):
            if frame and frame.locator('.s29-embed figure').count():
                break
            page.wait_for_timeout(100)
            frame = page.frame(url=base + '/embed/selftest')
        assert frame and frame.locator('.s29-embed figure').count(), 'cross-origin embed did not render'
        ordinary = context.request.get(base + '/')
        assert "frame-ancestors 'self'" in ordinary.headers['content-security-policy']
        assert ordinary.headers['x-frame-options'] == 'SAMEORIGIN'
        print('security headers: public cross-origin JSON, JSON 400, cross-origin embed, ordinary framing policy passed')
        browser.close()
    server.shutdown()
    server.server_close()


if __name__ == '__main__':
    main()
