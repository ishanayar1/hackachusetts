'use client';
// Scroll-pinned landing hero (GSAP ScrollTrigger): tagline, then a deep-blue card with the phone mockup, then the CTA.
// Adapted from the "cinematic landing hero" template for LastMile.
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import PhoneScreen, { LogoMark } from './PhoneScreen';

if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

export const GITHUB_URL = 'https://github.com/ishanayar1/hackachusetts';
const ELEVATORS_CHECKED = 14;

const STYLES = `
  .gsap-reveal { visibility: hidden; }
  .film-grain {
    position: absolute; inset: 0; pointer-events: none; z-index: 50; opacity: 0.05; mix-blend-mode: overlay;
    background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>');
  }
  .bg-grid-theme {
    background-size: 60px 60px;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--color-foreground) 6%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--color-foreground) 6%, transparent) 1px, transparent 1px);
    mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
  }
  .text-3d-matte {
    color: var(--color-foreground);
    text-shadow: 0 10px 30px color-mix(in srgb, var(--color-foreground) 20%, transparent), 0 2px 4px color-mix(in srgb, var(--color-foreground) 10%, transparent);
  }
  .text-silver-matte {
    background: linear-gradient(180deg, var(--color-foreground) 0%, color-mix(in srgb, var(--color-foreground) 40%, transparent) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    transform: translateZ(0);
    filter: drop-shadow(0 10px 20px color-mix(in srgb, var(--color-foreground) 15%, transparent)) drop-shadow(0 2px 4px color-mix(in srgb, var(--color-foreground) 10%, transparent));
  }
  .text-card-silver-matte {
    background: linear-gradient(180deg, #111111 0%, #4C3F6B 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    transform: translateZ(0);
    filter: drop-shadow(0 12px 24px rgba(60,40,100,0.25)) drop-shadow(0 4px 8px rgba(60,40,100,0.15));
  }
  .premium-depth-card {
    background: #DBCDF0;
    box-shadow: 0 40px 100px -20px rgba(60,40,100,0.45), 0 20px 40px -20px rgba(60,40,100,0.35), inset 0 1px 2px rgba(255,255,255,0.7), inset 0 -2px 4px rgba(60,40,100,0.15);
    border: 1px solid rgba(255,255,255,0.5);
  }
  .card-sheen {
    position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 50;
    background: radial-gradient(800px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.35) 0%, transparent 40%);
    mix-blend-mode: soft-light;
  }
  .iphone-bezel {
    background-color: #111;
    box-shadow: inset 0 0 0 2px #52525B, inset 0 0 0 7px #000, 0 40px 80px -15px rgba(0,0,0,0.9), 0 15px 25px -5px rgba(0,0,0,0.7);
    transform-style: preserve-3d;
  }
  .hardware-btn {
    background: linear-gradient(90deg, #404040 0%, #171717 100%);
    box-shadow: -2px 0 5px rgba(0,0,0,0.8), inset -1px 0 1px rgba(255,255,255,0.15), inset 1px 0 2px rgba(0,0,0,0.8);
  }
  .screen-glare { background: linear-gradient(110deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 45%); }
  .floating-ui-badge {
    background: linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.6) 100%);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.8), 0 25px 50px -12px rgba(60,40,100,0.4), inset 0 1px 1px #fff;
  }
  .btn-modern-light, .btn-modern-dark { transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); }
  .btn-modern-light {
    background: linear-gradient(180deg, #FFFFFF 0%, #F1F5F9 100%); color: #0F172A;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.1), 0 12px 24px -4px rgba(0,0,0,0.3), inset 0 1px 1px #fff, inset 0 -3px 6px rgba(0,0,0,0.06);
  }
  .btn-modern-light:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 6px 12px -2px rgba(0,0,0,0.15), 0 20px 32px -6px rgba(0,0,0,0.4), inset 0 1px 1px #fff, inset 0 -3px 6px rgba(0,0,0,0.06); }
  .btn-modern-light:active { transform: translateY(1px); background: linear-gradient(180deg, #F1F5F9 0%, #E2E8F0 100%); }
  .btn-modern-dark {
    background: linear-gradient(180deg, #27272A 0%, #18181B 100%); color: #fff;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.6), 0 12px 24px -4px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.8);
  }
  .btn-modern-dark:hover { transform: translateY(-3px); background: linear-gradient(180deg, #3F3F46 0%, #27272A 100%); }
  .btn-modern-dark:active { transform: translateY(1px); background: #18181B; }
`;

export default function CinematicHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCardRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  // Mouse-follow sheen and phone tilt (skipped for reduced motion).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onMove = (e: MouseEvent) => {
      if (window.scrollY > window.innerHeight * 2) return;
      cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(() => {
        if (!mainCardRef.current || !mockupRef.current) return;
        const rect = mainCardRef.current.getBoundingClientRect();
        mainCardRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        mainCardRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        gsap.to(mockupRef.current, { rotationY: x * 12, rotationX: -y * 12, ease: 'power3.out', duration: 1.2 });
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Scroll timeline: tagline blurs back, card rises and fills the screen, phone and badges fly in, then the CTA.
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const ctx = gsap.context(() => {
      gsap.set('.text-track', { autoAlpha: 0, y: 60, scale: 0.85, filter: 'blur(20px)', rotationX: -20 });
      gsap.set('.text-days', { autoAlpha: 1, clipPath: 'inset(0 100% 0 0)' });
      gsap.set('.main-card', { y: window.innerHeight + 200, autoAlpha: 1 });
      gsap.set(['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper', '.floating-badge', '.phone-widget'], { autoAlpha: 0 });
      gsap.set('.cta-wrapper', { autoAlpha: 0, scale: 0.8, filter: 'blur(30px)' });

      gsap
        .timeline({ delay: 0.3 })
        .to('.text-track', { duration: 1.8, autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', rotationX: 0, ease: 'expo.out' })
        .to('.text-days', { duration: 1.4, clipPath: 'inset(0 0% 0 0)', ease: 'power4.inOut' }, '-=1.0');

      gsap
        .timeline({
          scrollTrigger: { trigger: containerRef.current, start: 'top top', end: '+=7000', pin: true, scrub: 1, anticipatePin: 1 },
        })
        .to(['.hero-text-wrapper', '.bg-grid-theme'], { scale: 1.15, filter: 'blur(20px)', opacity: 0.2, ease: 'power2.inOut', duration: 2 }, 0)
        .to('.main-card', { y: 0, ease: 'power3.inOut', duration: 2 }, 0)
        .to('.main-card', { width: '100%', height: '100%', borderRadius: '0px', ease: 'power3.inOut', duration: 1.5 })
        .fromTo(
          '.mockup-scroll-wrapper',
          { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
          { y: 0, z: 0, rotationX: 0, rotationY: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 2.5 },
          '-=0.8',
        )
        .fromTo('.phone-widget', { y: 40, autoAlpha: 0, scale: 0.95 }, { y: 0, autoAlpha: 1, scale: 1, stagger: 0.15, ease: 'back.out(1.2)', duration: 1.5 }, '-=1.5')
        .to('.counter-val', { innerHTML: ELEVATORS_CHECKED, snap: { innerHTML: 1 }, duration: 2, ease: 'expo.out' }, '-=1.2')
        .fromTo(
          '.floating-badge',
          { y: 100, autoAlpha: 0, scale: 0.7, rotationZ: -10 },
          { y: 0, autoAlpha: 1, scale: 1, rotationZ: 0, ease: 'back.out(1.5)', duration: 1.5, stagger: 0.2 },
          '-=2.0',
        )
        .fromTo('.card-left-text', { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, ease: 'power4.out', duration: 1.5 }, '-=1.5')
        .fromTo('.card-right-text', { x: 50, autoAlpha: 0, scale: 0.8 }, { x: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 1.5 }, '<')
        .to({}, { duration: 2.5 })
        .set('.hero-text-wrapper', { autoAlpha: 0 })
        .set('.cta-wrapper', { autoAlpha: 1 })
        .to({}, { duration: 1.5 })
        .to(['.mockup-scroll-wrapper', '.floating-badge', '.card-left-text', '.card-right-text'], {
          scale: 0.9, y: -40, z: -200, autoAlpha: 0, ease: 'power3.in', duration: 1.2, stagger: 0.05,
        })
        .to('.main-card', { width: isMobile ? '92vw' : '85vw', height: isMobile ? '92vh' : '85vh', borderRadius: isMobile ? '32px' : '40px', ease: 'expo.inOut', duration: 1.8 }, 'pullback')
        .to('.cta-wrapper', { scale: 1, filter: 'blur(0px)', ease: 'expo.inOut', duration: 1.8 }, 'pullback')
        .to('.main-card', { y: -window.innerHeight - 300, ease: 'power3.in', duration: 1.5 });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#F4F2EC] text-foreground antialiased"
      style={{ perspective: '1500px' }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="film-grain" aria-hidden="true" />
      <div className="bg-grid-theme pointer-events-none absolute inset-0 z-0 opacity-50" aria-hidden="true" />

      {/* Tagline */}
      <div className="hero-text-wrapper absolute z-10 flex w-screen flex-col items-center justify-center px-4 text-center will-change-transform">
        <p className="text-track gsap-reveal mb-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold shadow-md">
          <LogoMark size={22} /> LastMile · for the MBTA
        </p>
        <h1 className="text-5xl md:text-7xl lg:text-[6rem]">
          <span className="text-track gsap-reveal text-3d-matte mb-2 block font-bold tracking-tight">Step-free trips,</span>
          <span className="text-days gsap-reveal text-silver-matte block font-extrabold tracking-tighter">no surprises.</span>
        </h1>
      </div>

      {/* Final CTA, revealed when the card pulls away */}
      <div className="cta-wrapper gsap-reveal pointer-events-auto absolute z-10 flex w-screen flex-col items-center justify-center px-4 text-center will-change-transform">
        <h2 className="text-silver-matte mb-6 text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">Never get stuck at the stairs.</h2>
        <p className="mx-auto mb-12 max-w-xl text-lg leading-relaxed text-slate-600 md:text-xl">
          Free, in your browser, on any phone. Add it to your home screen and it works like an app.
        </p>
        <div className="flex flex-col gap-6 sm:flex-row">
          <a href="/login" className="btn-modern-light group flex items-center justify-center gap-3 rounded-[1.25rem] px-8 py-4">
            <LogoMark size={32} />
            <span className="text-left">
              <span className="mb-[-2px] block text-[10px] font-bold uppercase tracking-wider text-neutral-500">Open the app</span>
              <span className="block text-xl font-bold leading-none tracking-tight">Plan a trip</span>
            </span>
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn-modern-dark group flex items-center justify-center gap-3 rounded-[1.25rem] px-8 py-4">
            <GitHubIcon className="h-7 w-7 transition-transform group-hover:scale-105" />
            <span className="text-left">
              <span className="mb-[-2px] block text-[10px] font-bold uppercase tracking-wider text-neutral-400">View source on</span>
              <span className="block text-xl font-bold leading-none tracking-tight">GitHub</span>
            </span>
          </a>
        </div>
      </div>

      {/* Deep-blue card */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" style={{ perspective: '1500px' }}>
        <div
          ref={mainCardRef}
          className="main-card premium-depth-card gsap-reveal pointer-events-auto relative flex h-[92vh] w-[92vw] items-center justify-center overflow-hidden rounded-[32px] md:h-[85vh] md:w-[85vw] md:rounded-[40px]"
        >
          <div className="card-sheen" aria-hidden="true" />
          <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-evenly px-4 py-6 lg:grid lg:grid-cols-3 lg:gap-8 lg:px-12 lg:py-0">
            {/* Brand: top on phones, right on desktop */}
            <div className="card-right-text gsap-reveal order-1 flex w-full justify-center lg:order-3 lg:justify-end">
              <h2 className="text-card-silver-matte text-6xl font-black uppercase leading-[0.85] tracking-tighter md:text-[5.5rem] lg:text-[7rem]">
                Last
                <br className="hidden lg:block" />
                Mile
              </h2>
            </div>

            {/* Phone */}
            <div className="mockup-scroll-wrapper relative order-2 flex h-[380px] w-full items-center justify-center lg:h-[600px]" style={{ perspective: '1000px' }}>
              <div className="relative flex h-full w-full scale-[0.65] items-center justify-center md:scale-85 lg:scale-100">
                <div ref={mockupRef} className="iphone-bezel relative flex h-[580px] w-[280px] flex-col rounded-[3rem] will-change-transform">
                  <div className="hardware-btn absolute -left-[3px] top-[120px] h-[25px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="hardware-btn absolute -left-[3px] top-[160px] h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="hardware-btn absolute -left-[3px] top-[220px] h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
                  <div className="hardware-btn absolute -right-[3px] top-[170px] h-[70px] w-[3px] scale-x-[-1] rounded-r-md" aria-hidden="true" />
                  <div className="absolute inset-[7px] z-10 overflow-hidden rounded-[2.5rem] shadow-[inset_0_0_15px_rgba(0,0,0,1)]">
                    <div className="screen-glare pointer-events-none absolute inset-0 z-40" aria-hidden="true" />
                    <div className="absolute left-1/2 top-[5px] z-50 flex h-[28px] w-[100px] -translate-x-1/2 items-center justify-end rounded-full bg-black px-3">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                    </div>
                    <PhoneScreen />
                  </div>
                </div>

                {/* Floating badges */}
                <div className="floating-badge floating-ui-badge absolute left-[-15px] top-6 z-30 flex items-center gap-3 rounded-xl p-3 lg:left-[-90px] lg:top-12 lg:gap-4 lg:rounded-2xl lg:p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/40 bg-amber-400/25 text-lg font-black text-amber-700 lg:h-10 lg:w-10">!</span>
                  <div>
                    <p className="text-xs font-bold tracking-tight text-[#111] lg:text-sm">Elevator out at Boylston</p>
                    <p className="text-[10px] font-medium text-slate-600 lg:text-xs">Rerouted via Arlington</p>
                  </div>
                </div>
                <div className="floating-badge floating-ui-badge absolute bottom-12 right-[-15px] z-30 flex items-center gap-3 rounded-xl p-3 lg:bottom-20 lg:right-[-90px] lg:gap-4 lg:rounded-2xl lg:p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-600/40 bg-emerald-400/25 text-emerald-700 lg:h-10 lg:w-10">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs font-bold tracking-tight text-[#111] lg:text-sm">
                      <span className="counter-val">0</span> elevators checked
                    </p>
                    <p className="text-[10px] font-medium text-slate-600 lg:text-xs">On your trip, just now</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pitch: bottom on phones, left on desktop */}
            <div className="card-left-text gsap-reveal order-3 flex w-full flex-col justify-center px-4 text-center lg:order-1 lg:px-0 lg:text-left">
              <h3 className="mb-0 text-2xl font-bold tracking-tight text-[#111] md:text-3xl lg:mb-5 lg:text-4xl">Every elevator, checked before you go.</h3>
              <p className="mx-auto hidden max-w-sm text-sm leading-relaxed text-slate-700 md:block md:text-base lg:mx-0 lg:max-w-none lg:text-lg">
                <span className="font-semibold text-[#111]">LastMile</span> watches MBTA elevator, ramp and lift outages live, plans subway trips that
                only use the ones that work, and tells you which entrance to take.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}
