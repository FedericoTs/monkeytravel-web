"use client";

import { motion } from "framer-motion";

// Map marker component
function MapMarker({
  number,
  x,
  y,
  color,
  delay,
  label,
}: {
  number: number;
  x: string;
  y: string;
  color: string;
  delay: number;
  label: string;
}) {
  return (
    <motion.div
      initial={{ scale: 0, y: -20 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 15 }}
      className="absolute group"
      style={{ left: x, top: y, transform: "translate(-50%, -100%)" }}
    >
      {/* Marker pin */}
      <div className="relative">
        <motion.div
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: delay }}
          className="relative"
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-lg"
            style={{ backgroundColor: color }}
          >
            {number}
          </div>
          <div
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: `6px solid ${color}`,
            }}
          />
        </motion.div>

        {/* Label tooltip */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.2 }}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 bg-white rounded shadow-md whitespace-nowrap"
        >
          <span className="text-[7px] font-medium text-gray-700">{label}</span>
        </motion.div>
      </div>
    </motion.div>
  );
}

// Animated route line
function RouteLine({ delay }: { delay: number }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 350">
      <defs>
        <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6B6B" />
          <stop offset="50%" stopColor="#00B4A6" />
          <stop offset="100%" stopColor="#FFD93D" />
        </linearGradient>
      </defs>

      {/* Route path */}
      <motion.path
        d="M 60 80 Q 80 120, 130 140 Q 160 160, 140 200 Q 120 240, 80 260 Q 50 280, 70 320"
        stroke="url(#routeGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0 1"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay, duration: 2, ease: "easeInOut" }}
      />

      {/* Walking dots animation */}
      <motion.circle
        r="4"
        fill="#FF6B6B"
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: "100%" }}
        transition={{ delay: delay + 0.5, duration: 3, repeat: Infinity, ease: "linear" }}
        style={{ offsetPath: "path('M 60 80 Q 80 120, 130 140 Q 160 160, 140 200 Q 120 240, 80 260 Q 50 280, 70 320')" }}
      >
        <animate attributeName="opacity" values="1;0.5;1" dur="0.8s" repeatCount="indefinite" />
      </motion.circle>
    </svg>
  );
}

export default function LiveMapScreen() {
  const markers = [
    { number: 1, x: "30%", y: "25%", color: "#FF6B6B", label: "Sagrada Família" },
    { number: 2, x: "65%", y: "42%", color: "#00B4A6", label: "Park Güell" },
    { number: 3, x: "70%", y: "60%", color: "#FFD93D", label: "Food Tour" },
    { number: 4, x: "40%", y: "78%", color: "#9B59B6", label: "Gothic Quarter" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Stylized map background */}
        <div className="absolute inset-0 bg-[#F8F4F0]">
          {/* Street grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 200 350">
            {/* Horizontal streets */}
            <line x1="0" y1="50" x2="200" y2="50" stroke="#CCC" strokeWidth="0.5" />
            <line x1="0" y1="100" x2="200" y2="100" stroke="#CCC" strokeWidth="0.5" />
            <line x1="0" y1="150" x2="200" y2="150" stroke="#E5E5E5" strokeWidth="2" />
            <line x1="0" y1="200" x2="200" y2="200" stroke="#CCC" strokeWidth="0.5" />
            <line x1="0" y1="250" x2="200" y2="250" stroke="#E5E5E5" strokeWidth="2" />
            <line x1="0" y1="300" x2="200" y2="300" stroke="#CCC" strokeWidth="0.5" />

            {/* Vertical streets */}
            <line x1="40" y1="0" x2="40" y2="350" stroke="#CCC" strokeWidth="0.5" />
            <line x1="100" y1="0" x2="100" y2="350" stroke="#E5E5E5" strokeWidth="2" />
            <line x1="160" y1="0" x2="160" y2="350" stroke="#CCC" strokeWidth="0.5" />

            {/* Parks/green areas */}
            <rect x="120" y="30" width="50" height="40" fill="#C8E6C9" rx="3" opacity="0.6" />
            <rect x="20" y="180" width="35" height="50" fill="#C8E6C9" rx="3" opacity="0.6" />
            <rect x="130" y="280" width="45" height="35" fill="#C8E6C9" rx="3" opacity="0.6" />
          </svg>

          {/* Water feature */}
          <div className="absolute right-0 top-[40%] w-8 h-32 bg-gradient-to-l from-[#90CAF9]/40 to-transparent" />
        </div>

        {/* Animated route */}
        <RouteLine delay={0.5} />

        {/* Map markers */}
        {markers.map((marker, index) => (
          <MapMarker
            key={marker.number}
            {...marker}
            delay={1.0 + index * 0.3}
          />
        ))}

        {/* Current location pulse */}
        <motion.div
          className="absolute"
          style={{ left: "30%", top: "25%", transform: "translate(-50%, -50%)" }}
        >
          <motion.div
            className="w-8 h-8 rounded-full bg-[#FF6B6B]/20"
            animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        </motion.div>
      </div>

      {/* Bottom info panel */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 100, damping: 15 }}
        className="bg-white rounded-t-2xl shadow-lg px-3 py-3"
      >
        {/* Trip stats */}
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[10px]">🚶</span>
              <span className="text-[10px] font-semibold text-gray-900">3.2 km</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px]">⏱️</span>
              <span className="text-[10px] font-semibold text-gray-900">6h 30m</span>
            </div>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-green-50 rounded-full">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-medium text-green-700">Live tracking</span>
          </div>
        </div>

        {/* Next activity card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="bg-gradient-to-r from-[#FF6B6B]/10 to-[#FF8E8E]/10 rounded-xl p-2 border border-[#FF6B6B]/20"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FF6B6B] rounded-lg flex items-center justify-center text-white font-bold text-[10px]">
              1
            </div>
            <div className="flex-1">
              <p className="text-[9px] text-gray-500">Next stop</p>
              <p className="text-[11px] font-semibold text-gray-900">Sagrada Família</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-gray-500">In</p>
              <p className="text-[11px] font-semibold text-[#FF6B6B]">12 min</p>
            </div>
          </div>
        </motion.div>

        {/* Navigation button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full mt-2 py-2 bg-[#FF6B6B] rounded-xl flex items-center justify-center gap-2 shadow-lg"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="text-[10px] font-semibold text-white">Start Navigation</span>
        </motion.button>
      </motion.div>
    </div>
  );
}
