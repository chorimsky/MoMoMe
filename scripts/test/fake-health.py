import http.server, json, os, sys
BODY = json.loads(os.environ["FAKE_BODY"]); CODE = int(os.environ["FAKE_CODE"]); Q = int(os.environ.get("FAKE_QUOTE", "200"))
class H(http.server.BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/health/deep"): self._send(CODE, BODY)
        else: self._send(404, {})
    def do_POST(self):
        self._send(Q, {"ok": Q == 200})
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
