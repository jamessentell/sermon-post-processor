import http from 'http';
import url from 'url';

let server: http.Server | null = null;

export function startAuthServer(port: number = 8888, timeoutMs: number = 300000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close();
    }

    const timeout = setTimeout(() => {
      if (server) {
        server.close();
        server = null;
      }
      reject(new Error('OAuth timeout - no authorization code received'));
    }, timeoutMs);

    server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);

      if (parsedUrl.pathname === '/callback') {
        const code = parsedUrl.query.code as string | undefined;
        const error = parsedUrl.query.error as string | undefined;

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e94560;">Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server!.close();
          server = null;
          reject(new Error(`OAuth error: ${error}`));
        } else if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #4ecca3;">Authorization Successful!</h1>
                <p>You can close this window and return to the app.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server!.close();
          server = null;
          resolve(code);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e94560;">Missing Authorization Code</h1>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(port, () => {
      console.log(`OAuth callback server listening on port ${port}`);
    });
  });
}

export function stopAuthServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
