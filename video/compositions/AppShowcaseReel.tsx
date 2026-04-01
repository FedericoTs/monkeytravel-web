import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  staticFile,
} from 'remotion';
import { COLORS, FONTS } from '../theme';

/**
 * AppShowcaseReel — 15s vertical reel using REAL app screenshots.
 *
 * Uses actual tour slides + app pages captured from monkeytravel.app.
 * Tour slides already contain beautiful phone mockups, so we display
 * them full-bleed with branded overlays for maximum impact.
 *
 * NARRATIVE (15s at 30fps = 450 frames):
 *
 *   HOOK        (0-2s)     → Bold branded text + hero app phone
 *   AI CHAT     (2-4.5s)   → Tour: AI chat building a trip (full-bleed)
 *   ITINERARY   (4.5-7s)   → Tour: Full itinerary (full-bleed)
 *   AI MODIFY   (7-9.5s)   → Tour: AI modifying plan (full-bleed)
 *   TOGETHER    (9.5-12s)  → Tour: Collaboration + voting (full-bleed)
 *   CTA         (12-15s)   → Logo + CTA
 */

// ─── Full-bleed screenshot with Ken Burns + entrance animation ──────
const FullBleedScreen: React.FC<{
  src: string;
  zoom?: [number, number];
  panY?: [number, number];
  enterFrom?: 'bottom' | 'right' | 'left' | 'scale';
}> = ({ src, zoom = [1.05, 1.12], panY = [10, -10], enterFrom = 'bottom' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enterSpring = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const p = frame / durationInFrames;

  let tx = 0;
  let ty = 0;
  let s = 1;

  if (enterFrom === 'bottom') ty = interpolate(enterSpring, [0, 1], [120, 0]);
  else if (enterFrom === 'right') tx = interpolate(enterSpring, [0, 1], [120, 0]);
  else if (enterFrom === 'left') tx = interpolate(enterSpring, [0, 1], [-120, 0]);
  else if (enterFrom === 'scale') s = interpolate(enterSpring, [0, 1], [0.85, 1]);

  const imgScale = interpolate(p, [0, 1], zoom);
  const imgPanY = interpolate(p, [0, 1], panY);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        transform: `translate(${tx}px, ${ty}px) scale(${s})`,
      }}
    >
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'top center',
          transform: `scale(${imgScale}) translateY(${imgPanY}px)`,
        }}
      />
    </div>
  );
};

// ─── Animated label pill ────────────────────────────────────────────
const StepBadge: React.FC<{
  text: string;
  color?: string;
  delay?: number;
}> = ({ text, color = COLORS.primary, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 12, stiffness: 180 } });

  return (
    <div
      style={{
        display: 'inline-block',
        fontFamily: FONTS.body,
        fontSize: 16,
        fontWeight: 800,
        color: COLORS.white,
        background: color,
        padding: '8px 20px',
        borderRadius: 24,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        transform: `scale(${s})`,
        boxShadow: `0 4px 16px ${color}50`,
      }}
    >
      {text}
    </div>
  );
};

// ─── Phone Frame (used only for Hook scene) ─────────────────────────
const PhoneFrame: React.FC<{
  children: React.ReactNode;
  scale?: number;
  y?: number;
}> = ({ children, scale = 1, y = 0 }) => {
  const W = 360;
  const H = 740;
  const B = 14;
  const R = 46;

  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%',
      width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2,
      transform: `translateY(${y}px) scale(${scale})`,
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: R, background: '#1a1a1a', padding: B,
        boxShadow: '0 40px 80px rgba(0,0,0,0.3), 0 15px 30px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.1)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: B + 8, left: '50%', marginLeft: -46, width: 92, height: 26, borderRadius: 13, background: '#000', zIndex: 10 }} />
        <div style={{ width: '100%', height: '100%', borderRadius: R - B, overflow: 'hidden', background: COLORS.background }}>
          {children}
        </div>
        <div style={{ position: 'absolute', inset: 0, borderRadius: R, background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 35%)', pointerEvents: 'none' }} />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 1: HOOK — Stop the scroll
// ═══════════════════════════════════════════════════════════════════════
const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const phoneSpring = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const phoneY = interpolate(phoneSpring, [0, 1], [500, -20]);

  const titleOp = interpolate(frame, [6, 16], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [6, 16], [30, 0], { extrapolateRight: 'clamp' });
  const subOp = interpolate(frame, [16, 26], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: `linear-gradient(170deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 60%, ${COLORS.primaryDeeper} 100%)`,
      overflow: 'hidden',
    }}>
      {/* Decorative orbs */}
      <div style={{ position: 'absolute', top: -60, right: -40, width: 280, height: 280, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.accent}35 0%, transparent 70%)` }} />
      <div style={{ position: 'absolute', bottom: 300, left: -60, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.secondaryLight}25 0%, transparent 70%)` }} />

      {/* Logo */}
      <div style={{ position: 'absolute', top: 44, left: 44, display: 'flex', alignItems: 'center', gap: 10, opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' }) }}>
        <Img src={staticFile('images/logo.png')} style={{ width: 34, height: 34, objectFit: 'contain' }} />
        <span style={{ fontFamily: FONTS.body, fontSize: 17, fontWeight: 700, color: COLORS.white }}>MonkeyTravel</span>
      </div>

      {/* Title */}
      <div style={{ position: 'absolute', top: 110, left: 44, right: 44, opacity: titleOp, transform: `translateY(${titleY}px)` }}>
        <div style={{ fontFamily: FONTS.heading, fontSize: 52, fontWeight: 700, color: COLORS.white, lineHeight: 1.12 }}>
          Plan Trips With Friends
        </div>
        <div style={{ fontFamily: FONTS.heading, fontSize: 48, fontWeight: 700, color: COLORS.accent, lineHeight: 1.15, fontStyle: 'italic', opacity: subOp, marginTop: 4 }}>
          in 30 Seconds
        </div>
      </div>

      {/* Phone — trip wizard (the real app!) */}
      <PhoneFrame scale={0.76} y={phoneY + 270}>
        <Img
          src={staticFile('video/screens/22-trip-wizard.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
        />
      </PhoneFrame>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 2: AI CHAT — Tell AI your dream trip
// ═══════════════════════════════════════════════════════════════════════
const SceneAIChat: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      {/* Full-bleed tour screenshot */}
      <FullBleedScreen
        src={staticFile('video/screens/06-tour-slide1-ai-chat.png')}
        zoom={[1.02, 1.08]}
        panY={[5, -8]}
        enterFrom="scale"
      />

      {/* Top gradient for badge readability */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(180deg, rgba(255,250,245,0.95) 0%, transparent 100%)' }} />

      {/* Step badge */}
      <div style={{ position: 'absolute', top: 36, left: 0, right: 0, textAlign: 'center' }}>
        <StepBadge text="Step 1" delay={5} />
      </div>

      {/* Bottom gradient for branding */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(0deg, rgba(255,250,245,0.9) 0%, transparent 100%)' }} />
      <div style={{
        position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center',
        opacity: interpolate(frame, [15, 25], [0, 0.5], { extrapolateRight: 'clamp' }),
      }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.slate }}>monkeytravel.app</span>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 3: ITINERARY — AI builds your plan
// ═══════════════════════════════════════════════════════════════════════
const SceneItinerary: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      <FullBleedScreen
        src={staticFile('video/screens/07-tour-slide2.png')}
        zoom={[1.02, 1.08]}
        panY={[5, -8]}
        enterFrom="right"
      />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(180deg, rgba(255,250,245,0.95) 0%, transparent 100%)' }} />
      <div style={{ position: 'absolute', top: 36, left: 0, right: 0, textAlign: 'center' }}>
        <StepBadge text="Step 2" color={COLORS.secondary} delay={5} />
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(0deg, rgba(255,250,245,0.9) 0%, transparent 100%)' }} />
      <div style={{
        position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center',
        opacity: interpolate(frame, [15, 25], [0, 0.5], { extrapolateRight: 'clamp' }),
      }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.slate }}>monkeytravel.app</span>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 4: AI MODIFY — Customize instantly
// ═══════════════════════════════════════════════════════════════════════
const SceneAIModify: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      <FullBleedScreen
        src={staticFile('video/screens/010-tour-slide5.png')}
        zoom={[1.02, 1.08]}
        panY={[5, -8]}
        enterFrom="bottom"
      />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(180deg, rgba(255,250,245,0.95) 0%, transparent 100%)' }} />
      <div style={{ position: 'absolute', top: 36, left: 0, right: 0, textAlign: 'center' }}>
        <StepBadge text="Step 3" color={COLORS.accent} delay={5} />
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(0deg, rgba(255,250,245,0.9) 0%, transparent 100%)' }} />
      <div style={{
        position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center',
        opacity: interpolate(frame, [15, 25], [0, 0.5], { extrapolateRight: 'clamp' }),
      }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.slate }}>monkeytravel.app</span>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 5: TOGETHER — Plan with friends
// ═══════════════════════════════════════════════════════════════════════
const SceneTogether: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: COLORS.background, overflow: 'hidden' }}>
      <FullBleedScreen
        src={staticFile('video/screens/011-tour-slide6.png')}
        zoom={[1.02, 1.08]}
        panY={[5, -8]}
        enterFrom="left"
      />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(180deg, rgba(255,250,245,0.95) 0%, transparent 100%)' }} />
      <div style={{ position: 'absolute', top: 36, left: 0, right: 0, textAlign: 'center' }}>
        <StepBadge text="NEW" color="#8B5CF6" delay={5} />
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(0deg, rgba(255,250,245,0.9) 0%, transparent 100%)' }} />
      <div style={{
        position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center',
        opacity: interpolate(frame, [15, 25], [0, 0.5], { extrapolateRight: 'clamp' }),
      }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.slate }}>monkeytravel.app</span>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SCENE 6: CTA — Try It Free
// ═══════════════════════════════════════════════════════════════════════
const SceneCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSpring = spring({ frame, fps, config: { damping: 10, stiffness: 120 } });
  const titleOp = interpolate(frame, [8, 18], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [8, 18], [30, 0], { extrapolateRight: 'clamp' });
  const btnSpring = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 12, stiffness: 150 } });
  const pulse = interpolate(frame % 30, [0, 15, 30], [1, 1.04, 1]);

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${COLORS.background} 0%, ${COLORS.primaryLight}25 100%)`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '18%', left: '-8%', width: 380, height: 380, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.primaryLight}20 0%, transparent 70%)` }} />
      <div style={{ position: 'absolute', bottom: '12%', right: '-8%', width: 320, height: 320, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.secondaryLight}18 0%, transparent 70%)` }} />

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <div style={{ transform: `scale(${logoSpring})` }}>
          <Img src={staticFile('images/logo.png')} style={{ width: 80, height: 80, objectFit: 'contain' }} />
        </div>

        <div style={{ opacity: titleOp, transform: `translateY(${titleY}px)`, textAlign: 'center', padding: '0 44px' }}>
          <div style={{ fontFamily: FONTS.heading, fontSize: 50, fontWeight: 700, color: COLORS.navy, lineHeight: 1.15 }}>
            Your Next Trip,
          </div>
          <div style={{ fontFamily: FONTS.heading, fontSize: 50, fontWeight: 700, color: COLORS.primary, lineHeight: 1.15, fontStyle: 'italic' }}>
            Planned by AI
          </div>
        </div>

        <div style={{
          transform: `scale(${btnSpring * pulse})`,
          background: COLORS.primary,
          padding: '18px 44px',
          borderRadius: 60,
          boxShadow: `0 8px 24px ${COLORS.primary}40`,
        }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 22, fontWeight: 700, color: COLORS.white }}>
            Plan a Trip Together
          </span>
        </div>

        <div style={{ display: 'flex', gap: 24, opacity: interpolate(frame, [28, 38], [0, 1], { extrapolateRight: 'clamp' }) }}>
          {['100% Free', 'No App Needed', '30 Seconds'].map((t) => (
            <span key={t} style={{ fontFamily: FONTS.body, fontSize: 15, fontWeight: 600, color: COLORS.slate }}>{t}</span>
          ))}
        </div>

        <div style={{
          opacity: interpolate(frame, [35, 45], [0, 1], { extrapolateRight: 'clamp' }),
          fontFamily: FONTS.body, fontSize: 20, fontWeight: 700, color: COLORS.secondary, marginTop: 8,
        }}>
          monkeytravel.app
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPOSITION — 15 seconds at 30fps
// ═══════════════════════════════════════════════════════════════════════
export const AppShowcaseReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.background }}>
      {/* HOOK: 0-59 (2s) */}
      <Sequence from={0} durationInFrames={60}>
        <SceneHook />
      </Sequence>

      {/* AI CHAT: 60-134 (2.5s) */}
      <Sequence from={60} durationInFrames={75}>
        <SceneAIChat />
      </Sequence>

      {/* ITINERARY: 135-209 (2.5s) */}
      <Sequence from={135} durationInFrames={75}>
        <SceneItinerary />
      </Sequence>

      {/* AI MODIFY: 210-284 (2.5s) */}
      <Sequence from={210} durationInFrames={75}>
        <SceneAIModify />
      </Sequence>

      {/* TOGETHER: 285-359 (2.5s) */}
      <Sequence from={285} durationInFrames={75}>
        <SceneTogether />
      </Sequence>

      {/* CTA: 360-449 (3s) */}
      <Sequence from={360} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
};
