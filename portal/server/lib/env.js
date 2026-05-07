'use strict';

/**
 * @module lib/env
 * @description Shared helpers for reading and writing the `.env` configuration
 * file that is bind-mounted into the container at {@link DOTENV_PATH}.
 *
 * Both `routes/wizard.js` and `routes/settings.js` delegate to these
 * functions so the serialisation / deserialisation logic lives in one place.
 *
 * Design notes:
 * - Values are always strings (the .env format has no typed values).
 * - Keys with characters outside `[A-Za-z0-9_]` are sanitised to `_` to
 *   prevent newline-injection or comment-injection into the file.
 * - Sensitive keys (password, secret, token, key) are redacted when
 *   `readEnv()` is called with `redact = true`.
 */

const fs   = require('node:fs');
const path = require('node:path');

/** Default path to the mounted .env file inside the container. */
const DOTENV_PATH = process.env.DOTENV_PATH || '/config/.env';

/** Keys whose values are replaced with a placeholder when redacting. */
const SENSITIVE_PATTERN = /pass|secret|token|key/i;

/** Replacement used for redacted values. */
const REDACT_PLACEHOLDER = '••••••••';

/**
 * Parse a `.env` file into a plain key→value object.
 *
 * Lines starting with `#` and blank lines are skipped.
 * Values are not unquoted — they are returned exactly as written.
 *
 * @param {string}  [filePath=DOTENV_PATH] - Absolute path to the env file.
 * @param {boolean} [redact=false]         - Replace sensitive values with
 *   {@link REDACT_PLACEHOLDER}.
 * @returns {Record<string, string>} Parsed key-value map (never throws).
 */
function readEnv(filePath = DOTENV_PATH, redact = false) {
  const result = {};
  let content  = '';

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return result; // file does not exist yet
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!key) continue;
    result[key] = redact && SENSITIVE_PATTERN.test(key) ? REDACT_PLACEHOLDER : val;
  }

  return result;
}

/**
 * Merge a partial key-value object into an existing `.env` file.
 *
 * Existing keys are updated in-place; new keys are appended.
 * Keys and values are sanitised before writing:
 * - Keys: only `[A-Za-z0-9_]` allowed (others replaced with `_`).
 * - Values: newline characters are stripped to prevent injection.
 *
 * @param {Record<string, string|number>} patch    - Key-value pairs to write.
 * @param {string} [filePath=DOTENV_PATH]           - Absolute path to the env
 *   file (created if it does not exist).
 * @throws {Error} If the directory cannot be created or the file cannot be
 *   written.
 */
function writeEnvPatch(patch, filePath = DOTENV_PATH) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch { /* new file — start empty */ }

  const lines = content.split('\n');

  for (const [rawKey, rawVal] of Object.entries(patch)) {
    if (typeof rawVal !== 'string' && typeof rawVal !== 'number') continue;

    const safeKey = rawKey.replaceAll(/[^A-Za-z0-9_]/g, '_');
    const safeVal = String(rawVal).replaceAll(/[\r\n]/g, '');
    const line    = `${safeKey}=${safeVal}`;

    const idx = lines.findIndex(l => l.startsWith(`${safeKey}=`));
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.filter(l => l !== '').join('\n') + '\n');
}

module.exports = {
  DOTENV_PATH,
  SENSITIVE_PATTERN,
  REDACT_PLACEHOLDER,
  readEnv,
  writeEnvPatch,
};
