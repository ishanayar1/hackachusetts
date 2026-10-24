import { describe, expect, it } from 'vitest';
import { LANGUAGES, mergeTranslations, translate } from '@/lib/i18n';
import { parseTranslations } from '@/lib/translate';

describe('interface translation', () => {
  it('has six languages, English first', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'es', 'pt', 'ht', 'zh-Hans', 'vi']);
  });

  it('shows English until a translation arrives, then uses it with placeholders filled', () => {
    expect(translate('es', 'See {name}', { name: 'Park Street' })).toBe('See Park Street');
    expect(mergeTranslations('es', { 'See {name}': 'Ver {name}' })).toBe(1);
    expect(translate('es', 'See {name}', { name: 'Park Street' })).toBe('Ver Park Street');
    expect(translate('en', 'See {name}', { name: 'Park Street' })).toBe('See Park Street');
  });

  it('rejects translations that drop or change a {placeholder}', () => {
    expect(mergeTranslations('pt', { 'Wait {n} min': 'Espere minutos', 'Exit by {door}': 'Saia por {porta}' })).toBe(0);
    expect(translate('pt', 'Wait {n} min', { n: 3 })).toBe('Wait 3 min');
  });
});

describe('parseTranslations (server)', () => {
  const src = ['Broken now', 'See {name}'];
  it('reads the JSON array, even inside a code fence', () => {
    expect(parseTranslations(src, '```json\n["Averías ahora", "Ver {name}"]\n```')).toEqual({
      'Broken now': 'Averías ahora',
      'See {name}': 'Ver {name}',
    });
  });
  it('drops bad entries and ignores malformed replies', () => {
    expect(parseTranslations(src, '["Averías ahora", "Ver"]')).toEqual({ 'Broken now': 'Averías ahora' });
    expect(parseTranslations(src, '["only one"]')).toEqual({});
    expect(parseTranslations(src, 'not json')).toEqual({});
    expect(parseTranslations(src, null)).toEqual({});
  });
});
