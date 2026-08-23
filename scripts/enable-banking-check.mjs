import fs from 'node:fs';
import crypto from 'node:crypto';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJwt({ appId, privateKeyPem }) {
  const iat = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: appId,
  };
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat,
    exp: iat + 3600,
  };

  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKeyPem);

  return `${unsignedToken}.${b64url(signature)}`;
}

async function main() {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  const country = process.env.ENABLE_BANKING_COUNTRY || 'ES';
  const printOnly = process.argv.includes('--print-token');

  if (!appId) {
    throw new Error('Missing ENABLE_BANKING_APP_ID');
  }

  if (!keyPath) {
    throw new Error('Missing ENABLE_BANKING_PRIVATE_KEY_PATH');
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key file not found: ${keyPath}`);
  }

  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const jwt = createJwt({ appId, privateKeyPem });

  if (printOnly) {
    console.log(jwt);
    return;
  }

  const response = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    console.error(`Enable Banking request failed: ${response.status}`);
    console.error(bodyText);
    process.exit(1);
  }

  const data = JSON.parse(bodyText);
  const aspsps = Array.isArray(data?.aspsps) ? data.aspsps : [];

  console.log(`ASPSPs in ${country}: ${aspsps.length}`);
  for (const aspsp of aspsps.slice(0, 20)) {
    const name = aspsp?.name || 'unknown';
    console.log(`- ${name}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
