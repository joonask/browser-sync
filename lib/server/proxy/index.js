var respMod   = require("resp-modifier");
var httpProxy = require("http-proxy");
var http      = require("http");
var https     = require("https");
var utils     = require("./lib/utils");
var url       = require("url");
var fs        = require("fs");

/**
 * @param opts
 * @param proxy
 * @param [additionalRules]
 * @param [additionalMiddleware]
 * @returns {*}
 */
function init(opts, proxy, additionalRules, additionalMiddleware, errHandler) {
    var proxyHost = proxy.host + ":" + proxy.port;
    var parsedUrl = url.parse(opts.target);
    var userAgentHeader = proxy.userAgentHeader;
    var isHttps = parsedUrl.protocol === "https:";
    var sslOptions = {
        key: fs.readFileSync(proxy.ssl.key),
        cert: fs.readFileSync(proxy.ssl.cert)
    };
    var proxyServerOptions = {
        secure: false
    };
    var proxyServer = httpProxy.createProxyServer(proxyServerOptions);
    var hostHeader  = utils.getProxyHost(opts);

    if (!errHandler) {
        errHandler = function (err) {
            console.log(err.message);
        };
    }

    var middleware  = respMod({
        rules: getRules()
    });

    var server = (isHttps) ? https.createServer(sslOptions, createServer).on("error", errHandler) : http.createServer(createServer).on("error", errHandler);

    // Handle proxy errors
    proxyServer.on("error", errHandler);

    // Remove headers
    proxyServer.on("proxyRes", function (res, originalReq, originalRes) {
        if (res.statusCode === 301) {
            res.statusCode = 302;
        }
        if (res.statusCode === 302) {
            res.headers.location = utils.handleRedirect(res.headers.location, opts, proxyHost);
        }

        // This header needs to be dropped because proxy works with http and https, depending which site we are testing.
        // The header enforces browsers to use https always: https://www.owasp.org/index.php/HTTP_Strict_Transport_Security
        if (res.headers["strict-transport-security"]) {
          delete res.headers["strict-transport-security"];
        }

        // No caching
        res.headers["cache-control"] = "no-cache";
        if (utils.isContentTypeTextHtml(res.headers["content-type"]) && (res.headers["content-encoding"] === "gzip" || res.headers["content-encoding"] === "deflate")) {
            delete res.headers["content-encoding"];
            if (res.headers["accept-bytes"]) {
                delete res.headers["accept-bytes"];
            }
            res.headers["x-zipped"] = true;
        }
    });

    // Inject custom user-agent header
    proxyServer.on("proxyReq", function(proxyReq, req, res, options) {
        if (userAgentHeader) {
            proxyReq.setHeader('User-Agent', userAgentHeader);
        }
    });

    function createServer(req, res) {
        var next = function () {
            utils.unzipRequestMiddleware(req, res, function() {
                proxyServer.web(req, res, {
                    target: opts.target,
                    headers: {
                        host: hostHeader,
                        "accept-encoding": "identity"
                    }
                });
            });
        };

        if (additionalMiddleware) {
            additionalMiddleware(req, res, function (success) {
                if (success) {
                    return;
                }
                utils.handleIe(req);
                middleware(req, res, next);
            });
        } else {
            utils.handleIe(req);
            middleware(req, res, next);
        }
    }

    function getRules() {

        var rules = [utils.rewriteLinks(opts, proxyHost)];

        if (additionalRules) {
            if (Array.isArray(additionalRules)) {
                additionalRules.forEach(function (rule) {
                    rules.push(rule);
                });
            } else {
                rules.push(additionalRules);
            }
        }
        return rules;
    }

    return server;
}

module.exports = {
    init: init
};
