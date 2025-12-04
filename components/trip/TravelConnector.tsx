"use client";

import { useMemo } from "react";
import { Footprints, Car, Bus, ArrowDown, Clock, MapPin } from "lucide-react";

interface TravelConnectorProps {
  distanceMeters?: number;
  durationSeconds?: number;
  durationText?: string;
  distanceText?: string;
  mode?: "WALKING" | "DRIVING" | "TRANSIT";
  isLoading?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * Visual connector between activities showing travel time and distance
 * Uses Fresh Voyager theme colors
 */
export function TravelConnector({
  distanceMeters,
  durationSeconds,
  durationText,
  distanceText,
  mode = "WALKING",
  isLoading = false,
  compact = false,
  className = "",
}: TravelConnectorProps) {
  const modeConfig = useMemo(() => {
    switch (mode) {
      case "WALKING":
        return {
          icon: Footprints,
          label: "Walk",
          color: "text-emerald-600",
          bgColor: "bg-emerald-50",
          borderColor: "border-emerald-200",
          dotColor: "bg-emerald-400",
        };
      case "DRIVING":
        return {
          icon: Car,
          label: "Drive",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
          dotColor: "bg-blue-400",
        };
      case "TRANSIT":
        return {
          icon: Bus,
          label: "Transit",
          color: "text-purple-600",
          bgColor: "bg-purple-50",
          borderColor: "border-purple-200",
          dotColor: "bg-purple-400",
        };
      default:
        return {
          icon: MapPin,
          label: "Travel",
          color: "text-gray-600",
          bgColor: "bg-gray-50",
          borderColor: "border-gray-200",
          dotColor: "bg-gray-400",
        };
    }
  }, [mode]);

  const Icon = modeConfig.icon;

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-2 ${className}`}>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div className="w-0.5 h-3 bg-gray-200 rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-gray-200 rounded-full animate-pulse my-1" />
            <div className="w-0.5 h-3 bg-gray-200 rounded-full animate-pulse" />
          </div>
          <div className="w-24 h-6 bg-gray-100 rounded-full animate-pulse" />
        </div>
      </div>
    );
  }

  // No data - simple arrow connector
  if (!distanceMeters && !durationSeconds) {
    return (
      <div className={`flex items-center justify-center py-2 ${className}`}>
        <div className="flex flex-col items-center">
          <div className="w-0.5 h-3 bg-gray-200 rounded-full" />
          <ArrowDown className="w-3 h-3 text-gray-300 my-0.5" />
          <div className="w-0.5 h-3 bg-gray-200 rounded-full" />
        </div>
      </div>
    );
  }

  // Format duration if not provided
  const displayDuration =
    durationText ||
    (durationSeconds ? `${Math.round(durationSeconds / 60)} min` : "");

  // Format distance if not provided
  const displayDistance =
    distanceText ||
    (distanceMeters
      ? distanceMeters < 1000
        ? `${Math.round(distanceMeters)} m`
        : `${(distanceMeters / 1000).toFixed(1)} km`
      : "");

  // Compact mode for timeline view
  if (compact) {
    return (
      <div className={`flex items-center justify-center py-1 ${className}`}>
        <div className="flex items-center gap-1.5 text-xs">
          <div className="w-0.5 h-2 bg-gray-200 rounded-full" />
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${modeConfig.bgColor}`}
          >
            <Icon className={`w-3 h-3 ${modeConfig.color}`} />
            <span className={`font-medium ${modeConfig.color}`}>
              {displayDuration}
            </span>
          </div>
          <div className="w-0.5 h-2 bg-gray-200 rounded-full" />
        </div>
      </div>
    );
  }

  // Full mode
  return (
    <div className={`flex items-center justify-center py-3 ${className}`}>
      <div className="flex items-center gap-3">
        {/* Connector line with dot */}
        <div className="flex flex-col items-center">
          <div className="w-0.5 h-4 bg-gradient-to-b from-gray-200 to-gray-300 rounded-full" />
          <div
            className={`w-2 h-2 rounded-full ${modeConfig.dotColor} ring-2 ring-white shadow-sm`}
          />
          <div className="w-0.5 h-4 bg-gradient-to-b from-gray-300 to-gray-200 rounded-full" />
        </div>

        {/* Travel info pill */}
        <div
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full
            ${modeConfig.bgColor} border ${modeConfig.borderColor}
            shadow-sm transition-all hover:shadow-md
          `}
        >
          <Icon className={`w-4 h-4 ${modeConfig.color}`} />

          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className={`font-semibold ${modeConfig.color}`}>
              {displayDuration}
            </span>
          </div>

          <span className="text-gray-300">|</span>

          <span className="text-xs text-gray-500 font-medium">
            {displayDistance}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TravelConnector;
