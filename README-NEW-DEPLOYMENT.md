# Deen Sphere — independent Firebase migration draft

This is a separate copy of the uploaded project. Do not replace the original GitHub repository, Vercel project, or Supabase project. This package contains no old Supabase runtime connection. JavaScript syntax was checked, but no live Firebase, Vercel, AI, browser, or push delivery tests were performed. Treat it as a migration draft, not a verified production release.

## 1. Create independent resources

Use a separate GitHub repository and Vercel project. Vercel Hobby is for eligible personal/non-commercial use. For all services, the account owner must meet the provider's eligibility requirements. Keep Firebase on Spark and use only AI projects that have free access and no billing enabled. Do not attach a billing account or use trial credits as a substitute for an ongoing free plan.

## 2. Firebase

In a new Firebase project, register a web application. In `public-config.js`, replace the placeholder `firebase` object with its web configuration. Do not put service-account JSON or private keys in this file. Enable Authentication > Sign-in method > Email/Password and Google if desired. Create a Firestore Standard database in production mode. In Firestore > Rules, publish the contents of `firestore.rules`. Create the collection-group single-field index for collection ID `data`, field `key`, ascending, collection-group scope (see `firestore.indexes.json`). The scheduler query needs this index. Alternatively deploy the included Firebase configuration with the Firebase CLI from an authorized account.

For server-side access, obtain a service-account credential for the NEW project from an authorized administrator. Store the full JSON in the new Vercel project's private `FIREBASE_SERVICE_ACCOUNT` environment variable. Never commit it or share it in chat. Prefer least-privilege IAM permissions appropriate for Firestore server access and Firebase Auth token verification. Check service-account policy before creating a key. Do not reuse the old project's credentials.

Firebase's default hosted password-reset page can be used without any extra template setup. If you want the custom Deen Sphere reset screen, set the reset email action URL in Firebase Authentication > Templates to the new deployment URL; the app recognizes `mode=resetPassword&oobCode=...`. Test expired and already-used links. Google OAuth needs the new deployment domain listed under Authentication > Settings > Authorized domains.

## 3. New web-push keys and private environment variables

On a development machine with Node.js installed, from this project folder run:

```
npm install
npx web-push generate-vapid-keys
```

Keep the generated private key private. Replace only `vapidPublicKey` in `public-config.js` with the new public key. Use the same public/private pair in Vercel. `public-config.js` contains public client configuration only.

Add these variables to the NEW Vercel project (Production environment):

| Variable | Value |
|---|---|
| FIREBASE_SERVICE_ACCOUNT | New Firebase service-account JSON, private |
| VAPID_PUBLIC_KEY | Newly generated public key |
| VAPID_PRIVATE_KEY | Matching private key, private |
| CRON_SECRET | A strong random secret (e.g. generate locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| APP_ORIGIN | New site's HTTPS origin, no path |
| GEMINI_API_KEY | Optional eligible free-tier Gemini key, private |
| GEMINI_MODEL | Exact model ID verified to have free quota in that project |
| GROQ_API_KEY | Optional eligible free-tier Groq key for voice transcription and fallback |
| GROQ_FAST_MODEL | Optional supported text model ID; check provider catalogue |
| GROQ_VISION_MODEL | Optional supported image model ID; check provider catalogue |
| GROQ_TRANSCRIPTION_MODEL | Optional supported speech-to-text model ID; check provider catalogue |
| TAVILY_API_KEY | Optional eligible free-tier search API key |
| SERPER_API_KEY | Optional search fallback; omit if only a limited trial or paid access is offered |

The existing AI design uses separate search and speech providers. Gemini alone does not enable the existing search or voice routes. The package intentionally does not assume a model is free merely because its name contains Flash. Verify model IDs and limits in the chosen account. If a provider is not configured, that feature may return an error. AI endpoints require Firebase sign-in; this is not a comprehensive abuse-prevention or rate-limiting system. Use small-scale testing first. AI answers and source citations still require verification. Provider policies and eligibility apply, and data sent to AI providers is subject to their own privacy terms.

## 4. New GitHub/Vercel deployment

Create a new repository and upload the extracted contents (not a ZIP inside the repository). Do not upload service-account files, .env, private keys, or node_modules. Commit the lockfile produced by `npm install` if successful; the obsolete Supabase lockfile was removed. Import the NEW repository into a separate Vercel project using the Other framework preset, project root, no custom build command, and the default output directory. Use the new environment variables above. Set APP_ORIGIN to its production HTTPS URL and redeploy if necessary. Check `/public-config.js` serves JavaScript rather than HTML, and check the service-worker scripts and icons are available.

## 5. Scheduled notifications

Create one external cron job (cron-job.org supports minute intervals). Set the URL to `https://YOUR-NEW-SITE.vercel.app/api/news-cron`, HTTP GET, every minute. Add a custom HTTP header `Authorization` with value `Bearer YOUR_CRON_SECRET`. Do not include the secret in the URL. Enable only after checking the new deployment, Firebase index, and a registered test device. A call without the header must be rejected. The old public test-push endpoint was disabled to prevent arbitrary push requests. News polling is now every 15 minutes; prayer timing retains the existing minute windows. The existing scheduler and service workers retain prayer reminders, prayer checks, Quran/Adhkar/birthday/news and open-app audio/modal logic. Browser permissions and compatible PWA installation are necessary, especially on iOS. Locked-screen notification delivery does not imply autoplay of full Azaan audio on a locked phone. Actual delivery depends on the operating system, push provider, scheduler and network.

**Important scaling limit:** this draft reads one settings document per configured account each minute, potentially 1,440 reads per account per day, plus normal app reads and delivery bookkeeping. Firestore Standard provides 50,000 free reads per day. Even around 30 configured accounts could approach that limit; it is not designed for unlimited users. External prayer API calls and Vercel function duration also consume resources. The in-memory timing cache only helps warm instances. A production-scale design needs a due-time index/queue, pruning of old notification state, and load testing. Cron can be delayed or disabled on failures; exact timing is not guaranteed. Never upgrade automatically to cover a quota.

## 6. Test before sharing

- Create a new account, log out, log back in, test Google sign-in and password reset.
- Verify Firestore contains `users/<uid>/data/settings` with `key: settings`; ensure one user cannot read another user's data. Test synchronization between two devices, including conflicting updates, and test profile photo/AI-history storage against the 1 MiB Firestore document limit.
- Enable notifications on one device. Check `users/<uid>/push_subscriptions/<hash>` contains subscription and notification preferences. Disable one preference and verify that device no longer receives that reminder. Test two devices, foreground and closed app, prayer checks, birthday/news and logout. Verify supported browser endpoint domains; the scheduler rejects unknown push endpoints for security.
- Test DeenGuide normal text, image attachments, voice transcription and search separately. Confirm the private APIs reject unauthenticated calls. Review source accuracy and quota errors.
- Check all original nav routes and UI, mobile gestures, Quran/audio and offline behavior. The existing HTML/CSS was retained, but cross-device synchronization now uses Firestore listeners instead of Supabase's broadcast mechanism. It may be slower. Archived HTML backups and the unused legacy FCM worker were excluded to avoid old project connections.
- Review Firebase/Vercel and each AI provider's usage dashboards. Keep no paid billing or paid fallbacks enabled.

## 7. Existing data

This is a new deployment with independent credentials and new user accounts. The original ZIP and existing cloud resources were not changed. Supabase account passwords, database records, push subscriptions, and existing user IDs are not automatically migrated. This package does not contain an export of your old database. An authorized export and a separately tested migration would be needed to copy records; old passwords may require users to re-register or reset. Existing devices need to subscribe to the new deployment.

Official plan references:
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://vercel.com/docs/plans/hobby
- https://cron-job.org/en/faq/
- https://ai.google.dev/gemini-api/docs/pricing

## Public repository security review

The old standalone `youtube_videos.html` copy was excluded from this package because it still embedded configuration for the old Firebase and Supabase projects. The active `index.html` does not reference that filename and was not changed in this security pass. Keep the original archive separately. Do not upload any credential files, even if ignored by Git (browser uploads do not honor .gitignore). The Firebase web configuration and VAPID public key are intentionally public; restrict the Firebase web key to the relevant APIs and keep the published Firestore rules. All server secrets belong only in Vercel environment variables. A static credential-pattern check is not a complete security audit. Verify live permissions and endpoint abuse protections before launch.
