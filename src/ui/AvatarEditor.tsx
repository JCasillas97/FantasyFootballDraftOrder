import { useEffect, useRef } from 'react';
import {
  type Avatar,
  SKIN_PALETTE,
  HAIR_PALETTE,
  HAIR_STYLES,
  FACIAL_STYLES,
  HEADGEAR_STYLES,
  GEAR_PALETTE,
  ACCESSORY_STYLES,
  HEIGHT_OPTIONS,
  BUILD_OPTIONS,
} from '../avatar/avatar';
import { composeAvatarSheet, Animation, SPRITE_W, SPRITE_H } from '../avatar/compose';

interface Props {
  avatar: Avatar;
  onChange: (next: Avatar) => void;
}

export function AvatarEditor({ avatar, onChange }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        background: 'var(--bg-panel)',
        border: '2px solid var(--border)',
        padding: 16,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <AvatarPreview avatar={avatar} scale={4} />
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>preview</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 12px',
          alignItems: 'center',
          flex: 1,
        }}
      >
        <Cycler
          label="Skin"
          value={avatar.skinTone}
          length={SKIN_PALETTE.length}
          onChange={(v) => onChange({ ...avatar, skinTone: v })}
          swatch={SKIN_PALETTE[avatar.skinTone]}
        />
        <Cycler
          label="Hair"
          value={avatar.hairStyle}
          length={HAIR_STYLES.length}
          labelFn={(i) => HAIR_STYLES[i]}
          onChange={(v) => onChange({ ...avatar, hairStyle: v })}
        />
        <Cycler
          label="Hair color"
          value={avatar.hairColor}
          length={HAIR_PALETTE.length}
          onChange={(v) => onChange({ ...avatar, hairColor: v })}
          swatch={HAIR_PALETTE[avatar.hairColor]}
        />
        <Cycler
          label="Facial"
          value={avatar.facialHair}
          length={FACIAL_STYLES.length}
          labelFn={(i) => FACIAL_STYLES[i]}
          onChange={(v) => onChange({ ...avatar, facialHair: v })}
        />
        <Cycler
          label="Headgear"
          value={avatar.headgear}
          length={HEADGEAR_STYLES.length}
          labelFn={(i) => HEADGEAR_STYLES[i]}
          onChange={(v) => onChange({ ...avatar, headgear: v })}
        />
        <Cycler
          label="Gear color"
          value={avatar.gearColor}
          length={GEAR_PALETTE.length}
          onChange={(v) => onChange({ ...avatar, gearColor: v })}
          swatch={GEAR_PALETTE[avatar.gearColor]}
        />
        <Cycler
          label="Accessory"
          value={avatar.accessory}
          length={ACCESSORY_STYLES.length}
          labelFn={(i) => ACCESSORY_STYLES[i]}
          onChange={(v) => onChange({ ...avatar, accessory: v })}
        />
        <Cycler
          label="Height"
          value={avatar.height ?? 1}
          length={HEIGHT_OPTIONS.length}
          labelFn={(i) => HEIGHT_OPTIONS[i]}
          onChange={(v) => onChange({ ...avatar, height: v })}
        />
        <Cycler
          label="Build"
          value={avatar.build ?? 1}
          length={BUILD_OPTIONS.length}
          labelFn={(i) => BUILD_OPTIONS[i]}
          onChange={(v) => onChange({ ...avatar, build: v })}
        />
      </div>
    </div>
  );
}

function Cycler({
  label,
  value,
  length,
  onChange,
  labelFn,
  swatch,
}: {
  label: string;
  value: number;
  length: number;
  onChange: (next: number) => void;
  labelFn?: (i: number) => string;
  swatch?: string;
}) {
  const prev = () => onChange((value - 1 + length) % length);
  const next = () => onChange((value + 1) % length);
  return (
    <>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={prev} style={{ padding: '2px 8px', fontSize: 11 }}>
          ◀
        </button>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 6px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            minWidth: 80,
            fontSize: 11,
          }}
        >
          {swatch && (
            <span
              style={{
                width: 12,
                height: 12,
                background: swatch,
                border: '1px solid var(--border)',
              }}
            />
          )}
          <span>{labelFn ? labelFn(value) : value + 1}</span>
        </div>
        <button onClick={next} style={{ padding: '2px 8px', fontSize: 11 }}>
          ▶
        </button>
      </div>
    </>
  );
}

export function AvatarPreview({ avatar, scale = 2 }: { avatar: Avatar; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const sheet = composeAvatarSheet(avatar);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      sheet,
      0,
      Animation.Idle * SPRITE_H,
      SPRITE_W,
      SPRITE_H,
      0,
      0,
      SPRITE_W * scale,
      SPRITE_H * scale,
    );
  }, [avatar, scale]);
  return (
    <canvas
      ref={canvasRef}
      width={SPRITE_W * scale}
      height={SPRITE_H * scale}
      style={{
        imageRendering: 'pixelated',
        display: 'block',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
      }}
    />
  );
}
