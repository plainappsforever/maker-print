// Export PDF through the system share sheet (SPEC §11, expo-sharing — no plugin: sharing OUT needs none).
import * as Sharing from 'expo-sharing';

export async function sharePdf(uri: string, dialogTitle: string): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
  return 'shared';
}
