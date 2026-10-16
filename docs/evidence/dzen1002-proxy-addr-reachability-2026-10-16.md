# proxy-addr: bounded read-only reachability assessment

2026-10-16. Baseline ffe3435; local lockfile/installed source only. No requests,
production config, credentials, dependency mutation or exploit demonstration.

npm audit --omit=dev reports proxy-addr2.0.7 as critical under
GHSA-jqcg-44mw-7w3h (IPv4-mapped IPv6 trust subnet / client-IP spoofing).
Lockfile path: contentops-studio -> express5.2.1 -> proxy-addr2.0.7;
forwarded0.2.0 and ipaddr.js1.9.1 are proxy-addr dependencies.
This is present baseline debt, not introduced by Dzen changes. No update run.

## Checked source and relevance

- package-lock.json records express's proxy-addr ^2.0.7 requirement and installed
  proxy-addr2.0.7. npm ls proxy-addr --all confirms this single installed path.
- src/mcp/remote-server.ts imports Express and constructs its app at line105.
  No trust proxy assignment, req.ip/req.ips access or IP allowlist appears in
  that file or the checked MCP authentication service/SDK transport graph.
- Installed Express application.js defaults trust proxy=false (line99).
  request.js ip/ips getters call proxy-addr with trust proxy fn. IPv4/IPv6 subnet
  trust compilation is not configured by the inspected MCP app.
- Remote MCP authorization derives bearer token/principal, using timing-safe
  comparison or managed-token authentication, then project-scopes requests.
  It does not select identity or tenant by forwarded client IP.
- Repository-wide src search for trust proxy, trustProxy, proxy-addr, proxyaddr,
  req.ip(s), request.ip(s) returns no explicit application consumers/configuration.
  The main API uses Fastify; auth route rate limits are Fastify configuration.

## Bounded conclusion

The affected package is installed and imported transitively by the deployed MCP
entry point. The specific configured-trust-subnet/client-IP authorization path
is not demonstrated reachable in this checked application configuration: trust
proxy remains false and bearer/tenant decisions do not consume proxy-derived IP.
This is not a proof that the dependency is safe, a finding closure or a claim
about uninspected production middleware/platform settings. No live deployment
configuration was read and other audit advisories were not assessed here.

Before deployment, maintainer must confirm the deployed source/config matches
this default and does not add IP/subnet trust or IP-based authorization middleware.
If that cannot be confirmed, deployment assessment stays unresolved. A dependency
upgrade is a separate reviewed maintenance change, not silently bundled with
Dzen or run through npm audit fix. Existing hard-stop policy still applies if an
exploitable authorization path is established. The passing quality gate alone
does not resolve dependency advisories.
