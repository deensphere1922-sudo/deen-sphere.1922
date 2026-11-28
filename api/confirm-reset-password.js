import { auth, db } from '../lib/firebase-admin.js';
import {
  randomBytes,
  scrypt,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

async function firebaseReset(body) {
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' +
    encodeURIComponent(process.env.FIREBASE_WEB_API_KEY),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    }
  );

  return {
    ok: response.ok,
    data: await response.json()
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  const { oobCode, password } = req.body || {};

  if (
    typeof oobCode !== 'string' ||
    !oobCode ||
    oobCode.length > 2048 ||
    typeof password !== 'string' ||
    password.length < 6 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: 'Invalid password reset request.'
    });
  }

  try {
    if (!process.env.FIREBASE_WEB_API_KEY) {
      throw new Error('Missing Firebase configuration');
    }

    // Verify the Firebase reset link.
    const verified = await firebaseReset({ oobCode });

    if (
      !verified.ok ||
      verified.data.requestType !== 'PASSWORD_RESET' ||
      !verified.data.email
    ) {
      return res.status(400).json({
        error: 'This reset link has expired or is invalid.'
      });
    }

    const user = await auth.getUserByEmail(
      verified.data.email
    );

    const historyRef = db.collection('password_history')
      .doc(user.uid);

    const snapshot = await historyRef.get();
    const history = snapshot.data()?.passwords || [];

    // Check the last five recorded passwords.
    for (const entry of history.slice(0, 5)) {
      const candidate = await deriveKey(
        password,
        Buffer.from(entry.salt, 'hex'),
        64
      );

      const previous = Buffer.from(entry.hash, 'hex');

      if (
        previous.length === candidate.length &&
        timingSafeEqual(candidate, previous)
      ) {
        return res.status(409).json({
          code: 'PASSWORD_REUSED',
          error: 'This password has already been used. Please choose a different password.'
        });
      }
    }

    // Prepare a securely salted password hash.
    const salt = randomBytes(32);
    const hash = await deriveKey(password, salt, 64);

    // Complete the reset through Firebase.
    const updated = await firebaseReset({
      oobCode,
      newPassword: password
    });

    if (!updated.ok) {
      return res.status(400).json({
        error: 'Unable to update password. Request a new reset link if necessary.'
      });
    }

    // Record the successful password change.
    try {
      await db.runTransaction(async tx => {
        const latest = await tx.get(historyRef);
        const previous = latest.data()?.passwords || [];

        tx.set(historyRef, {
          passwords: [
            {
              salt: salt.toString('hex'),
              hash: hash.toString('hex'),
              createdAt: Date.now()
            },
            ...previous
          ].slice(0, 5)
        });
      });
    } catch {
      console.error('Password history recording failed');
    }

    return res.status(200).json({
      success: true
    });

  } catch {
    console.error('Password reset confirmation failed');

    return res.status(500).json({
      error: 'Unable to update password. Please try again.'
    });
  }
}
