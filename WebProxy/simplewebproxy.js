/*
simplewebproxy.js - Ben Uriarte, Josh Hewlett, John Alden

This program proxies content from a destination HTTP server, output that content back to a browser.
The program accepts an incoming request to retrieve a file, connects to <server>:<port> to retrieve the file, 
and returns the content to the client. It assumes the content is HTML or a minimal set of MIME types. 
HTTP GET and HTTP POST are supported, but no other HTTP methods.

Errors returned from the HTTP server (400 and 500-level errors) are passed back to the client. Redirects are followed.

A max request option controls how many requests the browser can make before having to wait a short time to make a
new request.
*/
const http = require('http');
const url = require('url');
const cookie = require('cookie');
let idCounter = 0;
let rate_limiter = [];

let options = {
    local_port: '3000',
    hostname: 'www.public.asu.edu',
    port: '80',
    method: 'GET',
    max_requests: 25
};

// Server 
http.createServer((req, res) => {
    // Rate-limiting
    let clientCookie;
    let counterCookie;
    if (req.headers.cookie) { // If cookies exist in the request
        clientCookie = cookie.parse(req.headers.cookie).webproxy;
	bannedCookie = cookie.parse(req.headers.cookie).webproxyCounter;
    }
    if (clientCookie) { // Client is not counter.
        let index = parseInt(clientCookie);
        rate_limiter[index]++;
        if (rate_limiter[index] > options.max_requests) {
            res.setHeader('Set-Cookie', 'webproxyCounter='+rate_limiter[index]);
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(405);
            res.end("<html><head> Web Proxy Example </head><body>You maxed out your requests!</body></html>");
            return;
        }
    } else {
        let cook = 'webproxy=' + idCounter;
        rate_limiter.push(1);
        idCounter++;

        let expirationDate = new Date(Date.now() + 1000 * 60 * 10);
        expirationDate = expirationDate.toUTCString();
        cook = cook + ';expires=' + expirationDate;
        res.setHeader('Set-Cookie', cook);
    }

    if (req.method == 'GET') {
        let urlObj = url.parse(req.url, true, false);
        let path = urlObj.path;
        clientGETRequest(path, res);
    } else if (req.method == 'POST') {
        let buf = new Buffer(0);
        req.on('data', (c) => {
            buf = Buffer.concat([buf, c]);
        });
        req.on('end', (err) => {
            let contentType = req.headers['content-type'];
            let path = url.parse(req.url, true, false).path;
            clientPOSTRequest(path, res, contentType, buf);
        });
    } else {
        res.setHeader("Content-Type", "text/html");
        res.writeHeader(405);
        res.end("<html><head> Web Proxy Example </head><body>Request method is not allowed</body></html>");
    }
}).listen(options.local_port, () => {
    console.log("Server running on port:", options.local_port);
});

function clientGETRequest(path, res) {
    let clientOptions = {
        hostname: options.hostname,
        port: options.port,
        path: path,
        method: 'GET'
    }

    let cliReq = http.request(clientOptions, (resp) => {
        let buf = new Buffer(0);
        resp.on('data', (c) => {
            buf = Buffer.concat([buf, c]);
        });

        // Listener for error event so error is not thrown
        resp.on('error', (err) => {});

        resp.on('end', () => {
            if (resp.statusCode == 301 || resp.statusCode == 302 || resp.statusCode == 303 || resp.statusCode == 307 || resp.statusCode == 308) {
                resp.writeHead(resp.statusCode, {
                    'Location': hostname
                });
                resp.end();
            } else {
                res.setHeader("Content-Type", resp.headers["content-type"]);
                res.writeHeader(resp.statusCode);
                res.end(buf, 'binary');
            }
        });
    });
    cliReq.end();
}

function clientPOSTRequest(path, res, content_type, post_data) {
    let clientOptions = {
        hostname: options.hostname,
        port: options.port,
        path: path,
        method: 'POST',
        headers: {
            'Content-Type': content_type,
            'Content-Length': Buffer.byteLength(post_data)
        },
    }
    let postReq = http.request(clientOptions, (resp) => {
        let buf = new Buffer(0);
        resp.on('data', (c) => {
            buf = Buffer.concat([buf, c]);
        });

        // Listener for error event so error is not thrown
        resp.on('error', (err) => {});

        resp.on('end', () => {
            if (resp.statusCode == 301 || resp.statusCode == 302 || resp.statusCode == 303 || resp.statusCode == 307 || resp.statusCode == 308) {
                resp.writeHead(resp.statusCode, {
                    'Location': hostname
                });
                resp.end();
            } else {
                res.setHeader("Content-Type", resp.headers["content-type"]);
                res.writeHeader(resp.statusCode);
                res.end(buf, 'binary');
            }
        });
    });
    postReq.write(post_data);
    postReq.end();
}
