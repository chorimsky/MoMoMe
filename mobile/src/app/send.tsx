/* momome.xyz/send?to=…&amount=… opened in the app (app link / universal link): a receive
   link somebody shared on WhatsApp, or the bot's pay link. Hand it to the Send tab exactly
   as a scanned receive QR would be. */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function SendLink() {
  const p = useLocalSearchParams<{ to?: string; amount?: string }>();
  const to = typeof p.to === 'string' ? p.to.replace(/\D/g, '') : '';
  const amount = typeof p.amount === 'string' && /^\d+$/.test(p.amount) ? p.amount : undefined;
  return <Redirect href={{ pathname: '/', params: { ...(to ? { scanned: to } : {}), ...(amount ? { amount } : {}) } }} />;
}
