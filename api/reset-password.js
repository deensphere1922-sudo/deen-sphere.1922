import { auth, db } from '../lib/firebase-admin.js';
import { createHash } from 'node:crypto';

const APP_URL = 'https://deen-sphere1922.vercel.app/';

const hash = value =>
  createHash('sha256').update(value).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      error: 'Enter a valid email address.'
    });
  }

  const success = {
    success: true,
    message: 'If an account exists, a reset link will be sent.'
  };

  try {
    if (
      !process.env.BREVO_API_KEY ||
      !process.env.BREVO_SENDER_EMAIL
    ) {
      throw new Error('Brevo configuration missing');
    }

    // Rate limiting using Firestore
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);

    const emailRef = db.collection('password_reset_limits')
      .doc(hash(email));

    const dailyRef = db.collection('password_reset_limits')
      .doc('daily-' + day);

    const ip = String(
  req.headers['x-vercel-forwarded-for'] || 'unknown'
).split(',')[0].trim();

const ipRef = db.collection('password_reset_limits')
  .doc('ip-' + hash(ip + ':' + day));

    const allowed = await db.runTransaction(async tx => {
      const emailSnap = await tx.get(emailRef);
      const dailySnap = await tx.get(dailyRef);
      const ipSnap = await tx.get(ipRef);
const ipCount = ipSnap.data()?.count || 0;

if (ipCount >= 10) return false;

      const previous = emailSnap.data() || {};
      const daily = dailySnap.data() || {};

   // Minimum 1 second between requests
if (now - (previous.lastRequest || 0) < 1000) {
  return false;
}

      const count = previous.day === day
        ? previous.count || 0
        : 0;

      // Maximum 500 requests per email per day
if (count >= 500) return false;

      // Protect the free email allowance
      if ((daily.count || 0) >= 250) return false;

      tx.set(emailRef, {
        day,
        count: count + 1,
        lastRequest: now
      });

      tx.set(dailyRef, {
        count: (daily.count || 0) + 1
      });
tx.set(ipRef, {
  count: ipCount + 1,
  day
});
      return true;
    });

    if (!allowed) {
      return res.status(200).json(success);
    }

    // Generate secure Firebase reset code
    let firebaseLink;

    try {
      firebaseLink = await auth.generatePasswordResetLink(
        email,
        { url: APP_URL }
      );
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(200).json(success);
      }
      throw error;
    }

    const original = new URL(firebaseLink);
    const oobCode = original.searchParams.get('oobCode');

    if (
  original.protocol !== 'https:' ||
  original.searchParams.get('mode') !== 'resetPassword' ||
  !oobCode
) {
  throw new Error('Invalid Firebase reset link');
}

    // Open Deen Sphere's custom reset screen
    const resetURL = new URL(APP_URL);

    resetURL.searchParams.set('mode', 'resetPassword');
    resetURL.searchParams.set('oobCode', oobCode);

    const resetLink = resetURL.toString();
    const safeLink = resetLink.replace(/&/g, '&amp;');

    // Custom Deen Sphere email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <body style="
        margin:0;
        padding:24px;
        background:#ffffff;
        color:#171717;
        font-family:Arial,sans-serif;
      ">
        <div style="
          max-width:560px;
          margin:auto;
          line-height:1.7;
          font-size:15px;
        ">

          <p>Hello,</p>

          <p>
            We received a request to reset your
            Deen Sphere password.
          </p>

          <p>
            Click the button below to set a new password.
          </p>

          <a href="${safeLink}" style="
            display:block;
            background:#000000;
            color:#ffffff;
            text-align:center;
            padding:15px 20px;
            border-radius:9px;
            text-decoration:none;
            font-weight:600;
            margin:22px 0;
          ">
            Reset Password
          </a>

          <p>
            If you didn't request a password reset,
            you can safely ignore this email.
          </p>

          <p>
            Thanks,<br><br>
            The Deen Sphere Team
          </p>

        </div>
      </body>
      </html>
    `;

    // Send email through Brevo
    const response = await fetch(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          sender: {
            name: 'Deen Sphere',
            email: process.env.BREVO_SENDER_EMAIL
          },
          to: [{ email }],
          subject: 'Reset your Deen Sphere password',
          htmlContent,
          textContent:
            'Reset your Deen Sphere password: ' +
            resetLink +
            '\n\nIf you did not request this, ignore this email.'
        })
      }
    );

    if (!response.ok) {
      console.error('Brevo sending failed:', response.status);
      throw new Error('Email delivery failed');
    }

    return res.status(200).json(success);

  } catch (error) {
    console.error(
      'Password reset service error:',
      error.code || error.name
    );

    return res.status(200).json(success);
  }
}
