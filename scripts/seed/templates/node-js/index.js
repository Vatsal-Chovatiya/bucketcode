const http = require('http');

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html>
<html>
  <head><title>BucketCode</title></head>
  <body style="font-family: system-ui; padding: 2rem;">
    <h1>Hello from BucketCode 🚀</h1>
    <p>Edit <code>index.js</code> in the editor, then restart with <code>npm start</code>.</p>
  </body>
</html>`);
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
