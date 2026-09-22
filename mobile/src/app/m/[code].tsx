import { Redirect, useLocalSearchParams } from 'expo-router';

/** momome.xyz/m/<MOM-code> — the counter-poster QR. The same screen as a payment link:
 *  the pay page resolves a merchant code to an open-amount checkout. */
export default function MerchantPosterLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/pay/[code]', params: { code: String(code ?? '') } }} />;
}
