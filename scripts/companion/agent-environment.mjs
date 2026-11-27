import { dirname } from 'node:path';

// Keep each CLI's own local sign-in, never the companion's hosting credentials
// or inherited API keys. Use the same Node runtime as Tinykit for npm CLIs.
export function agentEnvironment(source = process.env) {
  const environment = Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && /^(HOME|USER|LOGNAME|PATH|TMPDIR|TMP|TEMP|LANG|LC_.*|CODEX_HOME|CLAUDE_CONFIG_DIR|XDG_CONFIG_HOME|XDG_CACHE_HOME|SHELL|TERM|COLORTERM|SYSTEMROOT|SystemRoot|WINDIR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(key)));
  if (environment.PATH) environment.PATH = dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + environment.PATH;
  return environment;
}
