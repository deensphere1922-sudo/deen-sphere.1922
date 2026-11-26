import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const raw=process.env.FIREBASE_SERVICE_ACCOUNT;
if(!raw) throw Error('FIREBASE_SERVICE_ACCOUNT missing');
const app=getApps()[0] || initializeApp({credential:cert(JSON.parse(raw))});
export const db=getFirestore(app);

import { getAuth } from 'firebase-admin/auth';
export async function requireUser(req,res){try {const token=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];if(!token)throw Error('Missing token');return await getAuth(app).verifyIdToken(token);}catch(e){res.status(401).json({error:'Sign in required.'});return null;}}
