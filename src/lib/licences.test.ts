// v1.1 (RELEASE_KIT 1c item 15): the generated notices cover what ships and nothing of the development client.
import { PRIVACY_URL } from '@/constants/links';

import { LICENCES, LICENCE_TEXTS } from './licences.generated';

describe('open-source licences', () => {
  it('every package has a licence id and a text; the engine and platform libraries are there; no dev client', () => {
    const names = LICENCES.map((r) => r[0]);
    for (const n of ['@cantoo/pdf-lib', '@xmldom/xmldom', 'react-native', 'react-native-svg', 'expo', 'expo-sqlite', 'react']) expect(names).toContain(n);
    expect(names.filter((n) => n.startsWith('expo-dev-'))).toEqual([]);
    for (const [, , id, ti] of LICENCES) {
      expect(id).toBeTruthy();
      expect(LICENCE_TEXTS[ti]?.length).toBeGreaterThan(100);
    }
  });
  it('the privacy page is the owner\'s https address', () => {
    expect(PRIVACY_URL).toBe('https://taulon.org/apps/maker-print/privacy');
  });
});
