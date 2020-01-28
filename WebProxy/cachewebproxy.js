/* 
 Example due to 
 Josh Hewlett
 John Alden
 Benjamin Uriarte
*/
const http = require('http');
const url = require('url');
const { URL, URLSearchParams } = require('url');
const cookie = require('cookie');
const LRU = require('lru-cache');
let idCounter = 0;
let rate_limiter = [
    []
];

let options = {
    local_port: '3000',
    hostname: 'www.public.asu.edu',
    port: '80',
    method: 'GET',
    max_requests: 15,
    cache_size: 1024,
    freshness: 10
};

let LRUoptions = {
    length: function(n, k) {
        return Buffer.byteLength(n[0])
    },
    dispose: function(k, n) {},
    max: options.cache_size * 1024,
    maxAge: 1000 * options.freshness,
}

let lruCache = LRU(LRUoptions);

function addtoCache(path, data, contentType, code) {
    lruCache.set(path, [data, contentType, code]);
    setTimeout((path) => {
        lruCache.peek(path);
    }, (options.freshness * 1000) + 10, path);
}

http.createServer((req, res) => {
    // Rate-limiting
    let clientCookie;
    let bannedCookie;
    if (req.headers.cookie) { // If cookies exist in the request
        clientCookie = cookie.parse(req.headers.cookie).webproxy;
        bannedCookie = cookie.parse(req.headers.cookie).webproxyBanned;
    }

    if (bannedCookie) { // Client is banned from making any more requests
        res.setHeader("Content-Type", "text/html");
        res.writeHeader(405);
        res.end("<html><head> MSG: </head><body>You maxed out your requests!</body></html>");
        return;
    } else if (clientCookie) { // Client is not banned.
        let index = parseInt(clientCookie);
        rate_limiter[index]++;
        if (rate_limiter[index] > options.max_requests) {
            res.setHeader('Set-Cookie', 'webproxyBanned=BANNED'); // Banning will not take affect until next request
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(405);
            res.end("<html><head> MSG: </head><body>You maxed out your requests!</body></html>");
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

    ///////////
    let urlObj = url.parse(req.url, true, false);
    let path = urlObj.path;
    let matches = /\/(admin)\/([a-z]{5})(\?|\/)?(.+)?/.exec(path);
    if (matches && matches[1] == "admin") {
        let params;
        if(matches[4]) {
            params = new URLSearchParams(matches[4])
        }
        adminRequest(res, req.method, matches[2], params)
    } else {
        if (req.method == 'GET') {
            clientGETRequest(path, res);
        } else if (req.method == 'POST') {
            let buf = new Buffer(0);
            req.on('data', (c) => {
                buf = Buffer.concat([buf, c]);
            });
            req.on('end', (err) => {
                let contentType = req.headers['content-type'];
                clientPOSTRequest(path, res, contentType, buf);
            });
        } else {
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(405);
            res.end("<html><head> MSG: </head><body>Request method is not allowed</body></html>");
        }
    }
}).listen(options.local_port, () => {
    console.log("Server running on port:", options.local_port);
});


function adminRequest(res, method, command, params) {
    if (method == "POST" && command == "reset") { // POST request
        lruCache.reset();
        res.setHeader("Content-Type", "text/html");
        res.writeHeader(200);
        res.end("<html><head> MSG: </head><body>Success reseting cache</body></html>");
        return;
    } else if (method == "DELETE" && command == "cache") { // Delete request
        if (lruCache.has(params.get("key"))) {
            lruCache.del(params.get("key"));
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(200);
            res.end("<html><head> MSG: </head><body>Successfully deleted</body></html>");
            return;
        } else {
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(404);
            res.end("<html><head> MSG: </head><body>Object does not exist</body></html>");
            return;
        }
    } else if (method == "GET" && command == "cache") { // GET request
        if (lruCache.has(params.get("key"))) {
            let chached_element = lruCache.get(params.get("key"));
            res.setHeader("Content-Type", cached_element[1]);
            res.writeHeader(cached_element[2]);
            res.end(cached_element[0], 'binary');
            return;
        } else {
            res.setHeader("Content-Type", "text/html");
            res.writeHeader(404);
            res.end("<html><head> MSG: </head><body>Object does not exist</body></html>");
            return;
        }
    } else if (method == "PUT" && command == "cache") { // PUT request
        addToCache(params.get("key"), params.get("value"), "text/plain", 200);
        res.setHeader("Content-Type", "text/html");
        res.writeHeader(200);
        res.end("<html><head> MSG: </head><body>Success updating object</body></html>");
        return;
    } else {
        res.setHeader("Content-Type", "text/html");
        res.writeHeader(401);
        res.end("<html><head> MSG: </head><body>Invalid request</body></html>");
        return;
    }
}

function clientGETRequest(path, res) {
    let clientOptions = {
        hostname: options.hostname,
        port: options.port,
        path: path,
        method: 'GET'
    }

    var cached_element;
    if (!(cached_element = lruCache.get(path))) {
        console.log("value not cached");
        let cliReq = http.request(clientOptions, (resp, callback) => {
            let buf = new Buffer(0);
            resp.on('data', (c) => {
                buf = Buffer.concat([buf, c]);
            });

            // Listener for error event so error is not thrown
            resp.on('error', (err) => {});

            resp.on('end', () => {
                if (resp.statusCode == 301 || resp.statusCode == 302 || resp.statusCode == 303 || resp.statusCode == 307 || resp.statusCode == 308) {
                    res.writeHead(resp.statusCode, {
                        'Location': options.hostname
                    });
                    res.end();
                } else {
                    console.log("caching data")
                    addtoCache(path, buf, resp.headers["content-type"], resp.statusCode);
                    res.setHeader("Content-Type", resp.headers["content-type"]);
                    res.writeHead(resp.statusCode);
                    res.end(buf, 'binary');
                }
            });
        });
        cliReq.end();
    } else {
        console.log("value cached");
        res.setHeader("Content-Type", cached_element[1]);
        res.writeHeader(cached_element[2]);
        res.end(cached_element[0], 'binary');
    }
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
