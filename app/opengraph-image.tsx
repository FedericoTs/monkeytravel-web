import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

export const alt = "MonkeyTravel - AI-Powered Trip Planning";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  const logoData = readFileSync(
    join(process.cwd(), "public/images/logo.png")
  );
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #2D3436 0%, #D94444 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Coral accent stripe at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 8,
            background: "linear-gradient(90deg, #FF6B6B, #FFD93D, #00B4A6)",
            display: "flex",
          }}
        />

        {/* Decorative teal circle top-right */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 320,
            height: 320,
            borderRadius: "50%",
            backgroundColor: "#00B4A6",
            opacity: 0.12,
            display: "flex",
          }}
        />

        {/* Decorative gold circle bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: -60,
            left: -60,
            width: 260,
            height: 260,
            borderRadius: "50%",
            backgroundColor: "#FFD93D",
            opacity: 0.1,
            display: "flex",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 120,
            height: 120,
            borderRadius: "50%",
            backgroundColor: "rgba(255, 255, 255, 0.12)",
            marginBottom: 32,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoBase64} width={88} height={88} alt="" />
        </div>

        {/* Brand name */}
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-1px",
            marginBottom: 16,
          }}
        >
          Monkey
          <span style={{ color: "#FFD93D" }}>Travel</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "rgba(255, 255, 255, 0.85)",
            marginBottom: 40,
          }}
        >
          AI-Powered Trip Planning Made Easy
        </div>

        {/* URL pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 24px",
            borderRadius: 999,
            backgroundColor: "rgba(255, 107, 107, 0.2)",
            border: "1.5px solid rgba(255, 107, 107, 0.4)",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 20,
              color: "#FFD93D",
              fontWeight: 600,
            }}
          >
            monkeytravel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
