// Map icons drawn in code on a canvas (no sprite sheet, no font glyphs): one image per name, added by MapView.
// Every point on the map is an icon whose shape carries the meaning, so nothing relies on color alone.
import type { Map as MlMap } from 'maplibre-gl';
import { MODEL_BINS, RECORDED_BINS, ROUTE_COLORS, type CrashMode } from './format';
import { arrowIconName } from './geo';

const S = 48; // canvas px; added at pixelRatio 2, so 24 css px at icon-size 1
const INK = '#111827';
const WHITE = '#ffffff';
const GREEN = '#047857';
const AMBER = '#b45309';
const RED = '#b91c1c';
const GREY = '#6b7280';
const BROWN = '#9a3412';
const PURPLE = '#7e22ce';

type Ctx = CanvasRenderingContext2D;
type Icon = { size?: number; draw: (c: Ctx) => void };

export function warnIconName(color: string): string {
  return `lm-warn-${color.replace('#', '').toLowerCase()}`;
}

export const STATION_ICON = {
  yes: 'lm-station-yes',
  partial: 'lm-station-partial',
  no: 'lm-station-no',
  unknown: 'lm-station-unknown',
} as const;

/** icon-image expression for the crash layer: a warning sign filled with the intersection's bin color. */
export function crashIcon(mode: CrashMode): unknown[] {
  const bins = mode === 'model' ? MODEL_BINS : RECORDED_BINS;
  const prop = mode === 'model' ? ['get', 'risk_yr'] : ['+', ['get', 'ped'], ['get', 'bike']];
  const expr: unknown[] = ['step', prop, warnIconName(bins[0].color)];
  for (const b of bins.slice(1)) expr.push(b.min, warnIconName(b.color));
  return expr;
}

// ---------- drawing helpers ----------
function circle(c: Ctx, r: number, fill: string, stroke: string, lw: number) {
  c.beginPath();
  c.arc(S / 2, S / 2, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  c.stroke();
}

function square(c: Ctx, fill: string, stroke: string, lw: number) {
  c.beginPath();
  c.roundRect(6, 6, 36, 36, 8);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  c.stroke();
}

function bang(c: Ctx, color: string, cx = S / 2, top = 14, h = 15) {
  c.fillStyle = color;
  c.fillRect(cx - 2.25, top, 4.5, h);
  c.beginPath();
  c.arc(cx, top + h + 5, 2.6, 0, Math.PI * 2);
  c.fill();
}

function cross(c: Ctx, color: string, d = 8, lw = 5) {
  c.beginPath();
  c.moveTo(S / 2 - d, S / 2 - d);
  c.lineTo(S / 2 + d, S / 2 + d);
  c.moveTo(S / 2 + d, S / 2 - d);
  c.lineTo(S / 2 - d, S / 2 + d);
  c.lineCap = 'round';
  c.lineWidth = lw;
  c.strokeStyle = color;
  c.stroke();
}

/** International symbol of access, simplified, centered in the canvas. */
function wheelchair(c: Ctx, color: string, scale = 0.8) {
  c.save();
  c.translate(S / 2, S / 2);
  c.scale(scale, scale);
  c.translate(-S / 2, -S / 2);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.arc(22, 9, 4, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(21, 16);
  c.lineTo(21, 28);
  c.lineTo(31, 28);
  c.lineTo(35, 38);
  c.moveTo(21, 21);
  c.lineTo(29, 21);
  c.stroke();
  c.beginPath();
  c.arc(21, 31, 10, Math.PI * 0.15, Math.PI * 1.45);
  c.stroke();
  c.restore();
}

function warnSign(fill: string): Icon {
  return {
    draw: (c) => {
      c.beginPath();
      c.moveTo(24, 4);
      c.lineTo(45, 41);
      c.lineTo(3, 41);
      c.closePath();
      c.lineJoin = 'round';
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = 3.5;
      c.strokeStyle = INK;
      c.stroke();
      bang(c, INK, 24, 15, 13);
    },
  };
}

function rampWedge(c: Ctx, color: string) {
  c.beginPath();
  c.moveTo(12, 34);
  c.lineTo(36, 34);
  c.lineTo(36, 16);
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

function arrow(color: string): Icon {
  return {
    size: 24,
    draw: (c) => {
      c.beginPath();
      c.moveTo(12, 2);
      c.lineTo(21, 20);
      c.lineTo(3, 20);
      c.closePath();
      c.lineJoin = 'round';
      c.lineWidth = 4;
      c.strokeStyle = WHITE;
      c.stroke();
      c.fillStyle = color;
      c.fill();
    },
  };
}

// ---------- registry ----------
const ICONS: Record<string, Icon> = {
  ...Object.fromEntries(
    [...new Set([...MODEL_BINS, ...RECORDED_BINS].map((b) => b.color))].map((col) => [warnIconName(col), warnSign(col)]),
  ),
  ...Object.fromEntries(
    [...new Set([...Object.values(ROUTE_COLORS), '#1d4ed8'])].map((col) => [arrowIconName(col), arrow(col)]),
  ),
  'lm-fatal': {
    draw: (c) => {
      circle(c, 19, INK, WHITE, 3);
      cross(c, WHITE, 8, 5);
    },
  },
  'lm-danger': {
    draw: (c) => {
      square(c, PURPLE, WHITE, 3);
      bang(c, WHITE);
    },
  },
  'lm-ramp-poor': {
    draw: (c) => {
      square(c, BROWN, WHITE, 3);
      rampWedge(c, WHITE);
    },
  },
  'lm-ramp-lip': {
    draw: (c) => {
      square(c, WHITE, BROWN, 4);
      rampWedge(c, BROWN);
      c.fillRect(9, 25, 3.5, 9); // the lip
    },
  },
  'lm-ramp-both': {
    draw: (c) => {
      square(c, BROWN, INK, 4);
      rampWedge(c, WHITE);
      c.fillRect(9, 25, 3.5, 9);
    },
  },
  [STATION_ICON.yes]: {
    draw: (c) => {
      circle(c, 19, GREEN, WHITE, 3);
      wheelchair(c, WHITE, 0.72);
    },
  },
  [STATION_ICON.partial]: {
    draw: (c) => {
      circle(c, 18, GREEN, AMBER, 5);
      wheelchair(c, WHITE, 0.66);
      c.beginPath();
      c.arc(38, 10, 8.5, 0, Math.PI * 2);
      c.fillStyle = AMBER;
      c.fill();
      bang(c, WHITE, 38, 4, 7);
    },
  },
  [STATION_ICON.no]: {
    draw: (c) => {
      circle(c, 18, WHITE, RED, 5);
      cross(c, RED, 7, 5);
    },
  },
  [STATION_ICON.unknown]: {
    draw: (c) => {
      circle(c, 13, GREY, WHITE, 3);
      c.fillStyle = WHITE;
      c.font = 'bold 18px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('?', S / 2, S / 2 + 1);
    },
  },
  // Hatch for the environmental-justice fill so it does not rely on color alone.
  'lm-hatch': {
    size: 16,
    draw: (c) => {
      c.fillStyle = 'rgba(13,148,136,0.10)';
      c.fillRect(0, 0, 16, 16);
      c.strokeStyle = 'rgba(15,118,110,0.55)';
      c.lineWidth = 2;
      for (const off of [-16, 0, 16]) {
        c.beginPath();
        c.moveTo(off, 16);
        c.lineTo(off + 16, 0);
        c.stroke();
      }
    },
  },
};

export const MAP_ICON_NAMES = Object.keys(ICONS);

/** Add every icon the map layers use. Safe to call again after a style change (skips existing images). */
export function addMapIcons(map: MlMap) {
  try {
    for (const [name, { size = S, draw }] of Object.entries(ICONS)) {
      if (map.hasImage(name)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d');
      if (!c) return;
      draw(c);
      map.addImage(name, c.getImageData(0, 0, size, size), { pixelRatio: 2 });
    }
  } catch (err) {
    // Missing icons only hide those points; the base map and the lines keep working.
    console.warn('Map icons could not be added', err);
  }
}
