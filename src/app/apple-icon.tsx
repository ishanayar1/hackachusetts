// Apple touch icon (iOS "Add to Home Screen"). iOS rounds the corners itself, so this is full bleed.
import { ImageResponse } from 'next/og';
import { IconArt } from './icons/icon-art';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<IconArt size={180} rounded={false} />, size);
}
