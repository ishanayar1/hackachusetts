// Shared LastMile home-screen icon, drawn for next/og ImageResponse (Satori: flexbox + inline styles only).
// A #1d4ed8 square with a white "LM" and a small up/down elevator mark. No image files needed.
// rounded=true: rounded-corner square (manifest purpose "any").
// rounded=false: full bleed (maskable icons and the Apple touch icon, whose OS applies its own mask);
// the art stays inside the central ~60%, so a maskable crop never cuts it.

export const ICON_BLUE = '#1d4ed8';

export function IconArt({ size, rounded }: { size: number; rounded: boolean }) {
  const s = size;
  const tri = Math.round(s * 0.1);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: ICON_BLUE,
        borderRadius: rounded ? Math.round(s * 0.22) : 0,
        color: 'white',
      }}
    >
      {/* Up and down arrows, like an elevator call button. */}
      <svg
        width={tri * 2}
        height={tri * 2.4}
        viewBox="0 0 20 24"
        style={{ marginBottom: Math.round(s * 0.04) }}
      >
        <polygon points="10,0 20,10 0,10" fill="white" />
        <polygon points="0,14 20,14 10,24" fill="white" />
      </svg>
      <div
        style={{
          display: 'flex',
          fontSize: Math.round(s * 0.36),
          lineHeight: 1,
          letterSpacing: -Math.round(s * 0.01),
        }}
      >
        LM
      </div>
    </div>
  );
}
