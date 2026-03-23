/**
 * GitHub OAuth — device flow (CLI) + web flow (browser).
 * JWT generation using Node built-in crypto. Zero dependencies.
 */

import { createHmac, randomBytes } from 'crypto';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');

/**
 * Start GitHub device flow (for CLI).
 * Returns { device_code, user_code, verification_uri, interval }
 */
export async function startDeviceFlow() {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user user:email',
    }),
  });

  return res.json();
}

/**
 * Poll GitHub device flow for access token.
 */
export async function pollDeviceFlow(deviceCode) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  return res.json();
}

/**
 * Exchange auth code for access token (web flow).
 */
export async function exchangeCode(code) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  return res.json();
}

/**
 * Get GitHub user profile from access token.
 */
export async function getGitHubUser(accessToken) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  return res.json();
}

/**
 * Generate JWT token.
 */
export function generateJWT(payload, expiresInDays = 90) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresInDays * 86400,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${claimsB64}`)
    .digest('base64url');

  return `${headerB64}.${claimsB64}.${signature}`;
}

/**
 * Verify and decode JWT token.
 */
export function verifyJWT(token) {
  try {
    const [headerB64, claimsB64, signature] = token.split('.');
    const expectedSig = createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${claimsB64}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString());

    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;

    return claims;
  } catch {
    return null;
  }
}

/**
 * Auth middleware — requires valid JWT.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  const claims = verifyJWT(token);
  if (!claims) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = claims;
  next();
}

/**
 * Optional auth — attaches user if present, continues either way.
 */
export function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    req.user = verifyJWT(token);
  }
  next();
}

export { GITHUB_CLIENT_ID, JWT_SECRET };
