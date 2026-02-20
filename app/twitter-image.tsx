import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

export const alt = "MonkeyTravel - AI-Powered Trip Planning";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
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
          backgroundColor: "#0A4B73",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Accent stripe at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 8,
            backgroundColor: "#F2C641",
            display: "flex",
          }}
        />

        {/* Decorative accent circle top-right */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 300,
            height: 300,
            borderRadius: "50%",
            backgroundColor: "#F2C641",
            opacity: 0.1,
            display: "flex",
          }}
        />

        {/* Decorative accent circle bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: -60,
            left: -60,
            width: 250,
            height: 250,
            borderRadius: "50%",
            backgroundColor: "#F2C641",
            opacity: 0.08,
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
          <img
            src={logoBase64}
            width={88}
            height={88}
            alt=""
          />
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
          <span style={{ color: "#F2C641" }}>Travel</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "rgba(255, 255, 255, 0.8)",
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
            gap: 8,
            padding: "10px 24px",
            borderRadius: 999,
            backgroundColor: "rgba(242, 198, 65, 0.15)",
            border: "1.5px solid rgba(242, 198, 65, 0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 20,
              color: "#F2C641",
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
