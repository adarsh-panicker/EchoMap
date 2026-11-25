interface EchoMapLogoProps {
  size?: number;
}

export function EchoMapLogo({ size = 40 }: EchoMapLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="EchoMap Logo"
    >
      <defs>
        <linearGradient id="echomap-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0f2d6b" />
          <stop offset="100%" stopColor="#6b0f26" />
        </linearGradient>
        <linearGradient id="echomap-wave" x1="12" y1="16" x2="52" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="55%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#echomap-bg)" stroke="url(#echomap-wave)" strokeWidth="2" />

      {/* Concentric ultrasonic sonar arcs */}
      <path
        d="M22 42C16.5 36.5 16.5 27.5 22 22"
        stroke="#38bdf8"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M15.5 48.5C6.5 39.5 6.5 24.5 15.5 15.5"
        stroke="#38bdf8"
        strokeOpacity="0.45"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M42 22C47.5 27.5 47.5 36.5 42 42"
        stroke="#fb7185"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M48.5 15.5C57.5 24.5 57.5 39.5 48.5 48.5"
        stroke="#fb7185"
        strokeOpacity="0.45"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Central chirp pulse */}
      <path
        d="M24 32H27.5L30 23L34 41L36.5 32H40"
        stroke="#f8fafc"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
