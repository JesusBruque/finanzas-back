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
  const header = { alg: 'RS256', typ: 'JWT', kid: appId };
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

function normalize(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildMatcher(target) {
  const tokens = normalize(target).split(' ').filter(Boolean);
  return (candidate) => {
    const normalizedCandidate = normalize(candidate);
    return tokens.every((token) => normalizedCandidate.includes(token));
  };
}

async function main() {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  const country = process.env.ENABLE_BANKING_COUNTRY || 'ES';
  const outputJson = process.argv.includes('--json');
  const targetsFromEnv = process.env.ENABLE_BANKING_TARGET_BANKS;

  if (!appId) throw new Error('Missing ENABLE_BANKING_APP_ID');
  if (!keyPath) throw new Error('Missing ENABLE_BANKING_PRIVATE_KEY_PATH');
  if (!fs.existsSync(keyPath)) throw new Error(`Private key file not found: ${keyPath}`);

  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const jwt = createJwt({ appId, privateKeyPem });

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
  const names = aspsps.map((item) => item?.name).filter(Boolean);

  const targets = targetsFromEnv
    ? targetsFromEnv.split(',').map((item) => item.trim()).filter(Boolean)
    : ['Unicaja', 'Caja Rural del Sur', 'Bankinter'];

  const results = [];
  for (const target of targets) {
    const matcher = buildMatcher(target);
    const matches = names.filter(matcher);

    results.push({
      target,
      found: matches.length > 0,
      matches,
    });

    if (outputJson) {
      continue;
    }

    if (matches.length > 0) {
      console.log(`[FOUND] ${target}`);
      for (const match of matches.slice(0, 5)) {
        console.log(`  - ${match}`);
      }
    } else {
      console.log(`[MISSING] ${target}`);
    }
  }

  if (outputJson) {
    const payload = {
      country,
      totalAspsps: names.length,
      targets: results,
      allTargetsFound: results.every((item) => item.found),
      sampleAspsps: names.slice(0, 20),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`ASPSPs in ${country}: ${names.length}`);
  const sample = names.slice(0, 20);
  if (sample.length > 0) {
    console.log('\nSample ASPSPs:');
    for (const name of sample) {
      console.log(`- ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
