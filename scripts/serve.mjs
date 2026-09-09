import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wgsl': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain' };
http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let file = resolve(root, '.' + pathname);
        if (file !== root && !file.startsWith(root + sep)) {
            res.writeHead(403);
            return res.end();
        }
        if ((await stat(file)).isDirectory())
            file = resolve(file, 'index.html');
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await readFile(file));
    }
    catch {
        res.writeHead(404);
        res.end('Not found');
    }
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Aureon Studio: http://localhost:${port}`));
