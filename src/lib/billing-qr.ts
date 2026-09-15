import { qrSvgDataUrl } from '@/lib/qr-svg';

export async function paymentQrImage(value: string | null | undefined): Promise<string | null> {
  const payload = value?.trim();
  if (!payload) return null;
  return qrSvgDataUrl(payload);
}
