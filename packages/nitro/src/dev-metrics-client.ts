// The dev-only runtime metrics client (D-200), injected into a generated project's
// index.html by the facilis Vite plugin in serve mode ONLY. It is dormant until the IDE
// posts an enable message (the future graph runtime lens asks for it): no wrapping, no
// timers, no traffic until then. It adds no HTTP endpoint and reports nothing beyond
// route template + method + status + duration — no query strings, bodies or headers.
//
// Plain JS in a string on purpose: it runs as a classic inline script in the preview
// document (WebContainer), before the app's module scripts, with no imports to resolve.
// Kept dependency-free and idempotent so an HMR re-injection never double-wraps.

/** Grep marker for the production-artifact check: this string must never appear in a build. */
export const DEV_METRICS_MARKER = "__facilisMetrics";

export const DEV_METRICS_CLIENT_SOURCE = String.raw`(() => {
  "use strict";
  var SOURCE = "vv-metrics";
  var FLUSH_MS = 1000;
  var MAX_BATCH = 256;
  var MAX_ROUTE_LEN = 128;
  if (window.__facilisMetrics) return;
  var state = { enabled: false };
  window.__facilisMetrics = state;
  var token = null;
  var matchers = [];
  var pending = [];
  var timer = null;
  var origFetch = null;
  var origOpen = null;
  var origSend = null;

  // Compile a route template ({id}, {id?}, {...slug}, [id], [[id]], [...slug]) into a
  // pathname regex. Segment-based like the analyzer's templates; a parameter is always
  // a whole segment. Returns null for anything malformed.
  function compile(template) {
    if (typeof template !== "string" || template.length === 0 || template.length > MAX_ROUTE_LEN) return null;
    if (template.charAt(0) !== "/") return null;
    var parts = template.slice(1).split("/");
    var re = "^";
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var brace = /^\{(?:\.\.\.)?([^{}]+?)(?:\?|\*)?\}$/.exec(part);
      var bracket = /^\[\[?(?:\.\.\.)?([^\[\]]+?)\]?\]$/.exec(part);
      var isCatchAll = part.indexOf("...") !== -1;
      var isOptional = part.charAt(1) === "[" || /\?\}$/.test(part) || /\*\}$/.test(part);
      if (brace || bracket) {
        if (isCatchAll) {
          if (i !== parts.length - 1) return null;
          re += isOptional ? "(?:/.*)?" : "/.+";
        } else {
          re += isOptional ? "(?:/[^/]+)?" : "/[^/]+";
        }
      } else {
        re += "/" + part.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
      }
    }
    re += "/?$";
    try { return { template: template, re: new RegExp(re) }; } catch (e) { return null; }
  }

  // Same-origin pathname only: query strings and hashes never enter a sample, and a
  // cross-origin URL is not one of the project's routes.
  function routeFor(url) {
    var parsed;
    try { parsed = new URL(url, location.href); } catch (e) { return null; }
    if (parsed.origin !== location.origin) return null;
    for (var i = 0; i < matchers.length; i++) {
      if (matchers[i].re.test(parsed.pathname)) return matchers[i].template;
    }
    return null;
  }

  function record(url, method, status, duration) {
    if (!token) return;
    var route = routeFor(url);
    // Unmatched requests (assets, HMR, third parties) are dropped, not bucketed (D-200).
    if (route === null) return;
    pending.push({
      route: route,
      method: String(method || "GET").toUpperCase(),
      status: status,
      duration: Math.round(duration * 100) / 100,
    });
    if (pending.length >= MAX_BATCH) flush();
  }

  function flush() {
    if (pending.length === 0 || !token) return;
    var samples = pending;
    pending = [];
    // "*" like the other preview shims: the payload carries no secret the parent did
    // not itself send (the token), and modes B/C are cross-origin by design.
    try { window.parent.postMessage({ source: SOURCE, type: "batch", token: token, samples: samples }, "*"); } catch (e) { /* parent gone */ }
  }

  // Transparency contract (D-200 spike): return the ORIGINAL promise untouched, never
  // read the body (streaming passes through), measure to response headers only, and
  // record aborts as status 0 on a separate branch so the app's rejection is unchanged.
  function wrapFetch() {
    if (origFetch || typeof window.fetch !== "function") return;
    origFetch = window.fetch;
    window.fetch = function (input, init) {
      var started = performance.now();
      var url = "";
      var method = "GET";
      try {
        if (typeof input === "string") url = input;
        else if (typeof URL !== "undefined" && input instanceof URL) url = input.href;
        else if (input && typeof input.url === "string") { url = input.url; method = input.method || method; }
        if (init && typeof init.method === "string") method = init.method;
      } catch (e) { /* opaque input: record nothing */ }
      var promise = origFetch.apply(this, arguments);
      promise.then(
        function (response) { record(url, method, response.status, performance.now() - started); },
        function () { record(url, method, 0, performance.now() - started); }
      );
      return promise;
    };
  }

  function wrapXhr() {
    var Xhr = window.XMLHttpRequest;
    if (origOpen || typeof Xhr !== "function") return;
    origOpen = Xhr.prototype.open;
    origSend = Xhr.prototype.send;
    Xhr.prototype.open = function (method, url) {
      this.__facilisMetricsMeta = { method: String(method || "GET"), url: String(url), started: 0 };
      return origOpen.apply(this, arguments);
    };
    Xhr.prototype.send = function () {
      var meta = this.__facilisMetricsMeta;
      if (meta) {
        meta.started = performance.now();
        // loadend fires for load, error, abort and timeout alike; status is 0 when the
        // request never completed. The body is never touched.
        this.addEventListener("loadend", function () {
          record(meta.url, meta.method, this.status || 0, performance.now() - meta.started);
        }, { once: true });
      }
      return origSend.apply(this, arguments);
    };
  }

  function unwrap() {
    if (origFetch) { window.fetch = origFetch; origFetch = null; }
    var Xhr = window.XMLHttpRequest;
    if (origOpen && typeof Xhr === "function") {
      Xhr.prototype.open = origOpen;
      Xhr.prototype.send = origSend;
      origOpen = null;
      origSend = null;
    }
  }

  // Only the actual parent window can enable or disable: event.source must be the
  // parent, so a sibling frame or the app itself cannot forge a control message.
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== SOURCE) return;
    if (data.type === "enable" && typeof data.token === "string" && data.token.length > 0 && Array.isArray(data.routes)) {
      token = data.token;
      matchers = [];
      for (var i = 0; i < data.routes.length; i++) {
        var compiled = compile(data.routes[i]);
        if (compiled) matchers.push(compiled);
      }
      pending = [];
      wrapFetch();
      wrapXhr();
      if (timer === null) timer = setInterval(flush, FLUSH_MS);
      state.enabled = true;
    } else if (data.type === "disable") {
      token = null;
      matchers = [];
      pending = [];
      if (timer !== null) { clearInterval(timer); timer = null; }
      unwrap();
      state.enabled = false;
    }
  });
})();
`;
