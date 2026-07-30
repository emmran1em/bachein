import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getToken } from './api';

/** Download an authenticated PDF and open the native share sheet (WhatsApp/Email/etc).
 *  On web, opens the file in a new tab (browser download). */
export async function sharePdf(url: string, filename: string) {
  const token = await getToken();
  const authedUrl = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
  if (Platform.OS === 'web') {
    // @ts-ignore web only
    window.open(authedUrl, '_blank');
    return;
  }
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.pdf$/i, '') + '.pdf';
  const dest = `${FileSystem.cacheDirectory}${safe}`;
  const r = await FileSystem.downloadAsync(authedUrl, dest);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(r.uri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
  }
}
