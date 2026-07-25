#!/usr/bin/env python3
"""Token-gated public ingress for raw Even events."""

from __future__ import annotations

import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from urllib.parse import urlsplit


MAX_BODY_BYTES = 4 * 1024 * 1024


def valid_ingress_path(path: str, token: str) -> bool:
    candidate = urlsplit(path).path.removeprefix("/even/")
    return bool(token) and hmac.compare_digest(candidate, token)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        token = os.environ.get("EVEN_INGRESS_TOKEN", "")
        if not valid_ingress_path(self.path, token):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_response(413)
            self.end_headers()
            return
        body = self.rfile.read(length)
        connection = http.client.HTTPConnection("127.0.0.1", 8000, timeout=10)
        try:
            connection.request(
                "POST",
                "/api/v1/hardware/even",
                body=body,
                headers={
                "Content-Type": self.headers.get("Content-Type", "application/json"),
                "X-Snake1-Relay-Token": token,
                },
            )
            response = connection.getresponse()
            payload = response.read()
            self.send_response(response.status)
            self._cors()
            self.send_header(
                "Content-Type",
                response.getheader("Content-Type", "application/json"),
            )
            self.end_headers()
            self.wfile.write(payload)
        except OSError as exc:
            print(f"[even-ingress] upstream unavailable: {exc}")
            self.send_response(502)
            self._cors()
            self.end_headers()
        finally:
            connection.close()

    def log_message(self, fmt, *args):
        print(f"[even-ingress] {fmt % args}")


def main():
    token = os.environ.get("EVEN_INGRESS_TOKEN", "")
    if not token:
        raise SystemExit("EVEN_INGRESS_TOKEN is required")
    port = int(os.environ.get("PORT", "8788"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Secure Even ingress listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
