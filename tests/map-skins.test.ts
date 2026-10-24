import { describe, expect, it } from 'vitest';
import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';
import { labelLayerId, SKINS, skinStyles } from '@/lib/ui/map-skins';

const POSITRON = 'https://tiles.openfreemap.org/styles/positron';

describe('map skins', () => {
  it('satellite is an inline raster style with attribution and glyphs, then falls back to light', () => {
    const [sat, fallback] = skinStyles('satellite');
    expect(fallback).toBe(POSITRON);
    const style = sat as StyleSpecification;
    expect(style.glyphs).toContain('{fontstack}');
    const src = Object.values(style.sources)[0] as RasterSourceSpecification;
    expect(src.type).toBe('raster');
    expect(src.tiles?.[0]).toContain('World_Imagery/MapServer/tile/{z}/{y}/{x}');
    expect(src.attribution).toMatch(/Esri/);
  });

  it('maps vector skins to OpenFreeMap and ignores unknown ids', () => {
    expect(skinStyles('dark')[0]).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(skinStyles('light')).toEqual([POSITRON]);
    expect(skinStyles('nope')).toEqual([POSITRON]);
  });

  it('offers five skins', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['light', 'streets', 'bright', 'dark', 'satellite']);
  });
});

describe('labelLayerId', () => {
  it('skips symbol layers that sit under later fills (OpenFreeMap dark: water_name before building)', () => {
    const layers = [
      { id: 'water', type: 'fill' },
      { id: 'water_name', type: 'symbol' },
      { id: 'building', type: 'fill' },
      { id: 'road', type: 'line' },
      { id: 'road_label', type: 'symbol' },
      { id: 'place_label', type: 'symbol' },
    ];
    expect(labelLayerId(layers)).toBe('road_label');
  });

  it('is undefined when the style has no labels on top (satellite)', () => {
    expect(labelLayerId([{ id: 'sat', type: 'raster' }])).toBeUndefined();
  });
});
