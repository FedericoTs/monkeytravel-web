/**
 * Route Optimization for Daily Activities
 *
 * Minimizes total travel distance using 2-opt algorithm
 * while respecting time constraints (meals, fixed appointments).
 */

import type { Activity } from "@/types";

interface Coordinates {
  lat: number;
  lng: number;
}

export interface OptimizationResult {
  originalOrder: Activity[];
  optimizedOrder: Activity[];
  originalDistanceMeters: number;
  optimizedDistanceMeters: number;
  savingsMeters: number;
  savingsPercent: number;
  updatedStartTimes: Map<string, string>;
  swapsPerformed: number;
}

export interface OptimizationConstraints {
  /** Keep these activities in their current positions (e.g., restaurant at lunch) */
  fixedActivityIds?: string[];
  /** Meal windows: activities of type "restaurant" should stay in these ranges */
  mealWindows?: {
    lunch: { start: string; end: string }; // e.g., "12:00" - "14:00"
    dinner: { start: string; end: string }; // e.g., "19:00" - "21:00"
  };
  /** First activity of the day should not change */
  keepFirstActivity?: boolean;
  /** Last activity of the day should not change */
  keepLastActivity?: boolean;
}

// ============================================================
// DISTANCE CALCULATION (Haversine)
// ============================================================

/**
 * Calculate straight-line distance using Haversine formula
 * @returns Distance in meters
 */
function calculateHaversineDistance(
  origin: Coordinates,
  destination: Coordinates
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = (origin.lat * Math.PI) / 180;
  const lat2Rad = (destination.lat * Math.PI) / 180;
  const deltaLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  const deltaLng = ((destination.lng - origin.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Estimate road distance from straight-line (accounts for urban grid)
 */
function estimateRoadDistance(straightLineMeters: number): number {
  let factor: number;
  if (straightLineMeters < 500) {
    factor = 1.2;
  } else if (straightLineMeters < 2000) {
    factor = 1.3;
  } else if (straightLineMeters < 5000) {
    factor = 1.35;
  } else {
    factor = 1.4;
  }
  return Math.round(straightLineMeters * factor);
}

/**
 * Get distance between two activities in meters
 */
function getDistanceBetween(a: Activity, b: Activity): number {
  if (!a.coordinates?.lat || !a.coordinates?.lng || !b.coordinates?.lat || !b.coordinates?.lng) {
    return 0; // Can't calculate without coordinates
  }
  const straightLine = calculateHaversineDistance(a.coordinates, b.coordinates);
  return estimateRoadDistance(straightLine);
}

/**
 * Calculate total route distance for an array of activities
 */
function calculateTotalDistance(activities: Activity[]): number {
  let total = 0;
  for (let i = 0; i < activities.length - 1; i++) {
    total += getDistanceBetween(activities[i], activities[i + 1]);
  }
  return total;
}

// ============================================================
// TIME UTILITIES
// ============================================================

/**
 * Parse time string "HH:MM" to minutes since midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Format minutes since midnight to "HH:MM"
 */
function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Get travel time in minutes based on distance
 */
function getTravelTimeMinutes(distanceMeters: number): number {
  // Rough estimate: 4.8 km/h walking for short, 25 km/h driving for longer
  const isWalkable = distanceMeters < 1200;
  const speedKmh = isWalkable ? 4.8 : 22;
  const speedMpm = speedKmh * 1000 / 60; // meters per minute
  return Math.ceil(distanceMeters / speedMpm);
}

/**
 * Calculate new start times after reordering
 */
function recalculateStartTimes(
  activities: Activity[],
  firstStartTime: string
): Map<string, string> {
  const times = new Map<string, string>();
  if (activities.length === 0) return times;

  let currentMinutes = parseTimeToMinutes(firstStartTime);

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const activityId = activity.id || `activity-${i}`;
    times.set(activityId, formatMinutesToTime(currentMinutes));

    // Add duration + travel to next
    currentMinutes += activity.duration_minutes || 60;

    if (i < activities.length - 1) {
      const travelDistance = getDistanceBetween(activity, activities[i + 1]);
      const travelTime = getTravelTimeMinutes(travelDistance);
      currentMinutes += travelTime;
    }
  }

  return times;
}

// ============================================================
// CONSTRAINT HANDLING
// ============================================================

/**
 * Check if an activity is a meal (restaurant type)
 */
function isMealActivity(activity: Activity): boolean {
  const mealTypes = ["restaurant", "food", "cafe", "bar", "foodie"];
  return mealTypes.includes(activity.type?.toLowerCase() || "");
}

/**
 * Check if a time falls within a window
 */
function isTimeInWindow(time: string, window: { start: string; end: string }): boolean {
  const timeMinutes = parseTimeToMinutes(time);
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);
  return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
}

/**
 * Validate if proposed order respects constraints
 */
function validateConstraints(
  activities: Activity[],
  startTimes: Map<string, string>,
  constraints: OptimizationConstraints
): boolean {
  if (!constraints.mealWindows) return true;

  for (const activity of activities) {
    if (!isMealActivity(activity)) continue;

    const activityId = activity.id || "";
    const proposedTime = startTimes.get(activityId);
    if (!proposedTime) continue;

    const originalTime = activity.start_time;
    const originalMinutes = parseTimeToMinutes(originalTime);

    // Check if this is a lunch or dinner based on original time
    const isLunch = originalMinutes >= parseTimeToMinutes("11:00") &&
                    originalMinutes <= parseTimeToMinutes("15:00");
    const isDinner = originalMinutes >= parseTimeToMinutes("18:00") &&
                     originalMinutes <= parseTimeToMinutes("22:00");

    if (isLunch && constraints.mealWindows.lunch) {
      if (!isTimeInWindow(proposedTime, constraints.mealWindows.lunch)) {
        return false; // Lunch moved outside lunch window
      }
    }

    if (isDinner && constraints.mealWindows.dinner) {
      if (!isTimeInWindow(proposedTime, constraints.mealWindows.dinner)) {
        return false; // Dinner moved outside dinner window
      }
    }
  }

  return true;
}

// ============================================================
// 2-OPT OPTIMIZATION ALGORITHM
// ============================================================

/**
 * Perform 2-opt swap: reverse the segment between i and j
 */
function twoOptSwap<T>(array: T[], i: number, j: number): T[] {
  const result = [...array];
  // Reverse elements from index i to j (inclusive)
  while (i < j) {
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
    i++;
    j--;
  }
  return result;
}

/**
 * Get indices of activities that can be moved
 */
function getMovableIndices(
  activities: Activity[],
  constraints: OptimizationConstraints
): Set<number> {
  const movable = new Set<number>();

  for (let i = 0; i < activities.length; i++) {
    // Skip first if constrained
    if (constraints.keepFirstActivity && i === 0) continue;
    // Skip last if constrained
    if (constraints.keepLastActivity && i === activities.length - 1) continue;
    // Skip fixed activities
    if (constraints.fixedActivityIds?.includes(activities[i].id || "")) continue;

    movable.add(i);
  }

  return movable;
}

/**
 * Optimize route using 2-opt algorithm
 */
export function optimizeRoute(
  activities: Activity[],
  constraints: OptimizationConstraints = {}
): OptimizationResult {
  // Handle edge cases
  if (activities.length <= 2) {
    return {
      originalOrder: activities,
      optimizedOrder: activities,
      originalDistanceMeters: calculateTotalDistance(activities),
      optimizedDistanceMeters: calculateTotalDistance(activities),
      savingsMeters: 0,
      savingsPercent: 0,
      updatedStartTimes: recalculateStartTimes(activities, activities[0]?.start_time || "09:00"),
      swapsPerformed: 0,
    };
  }

  // Filter out activities without coordinates
  const activitiesWithCoords = activities.filter(
    a => a.coordinates?.lat && a.coordinates?.lng
  );

  if (activitiesWithCoords.length <= 2) {
    return {
      originalOrder: activities,
      optimizedOrder: activities,
      originalDistanceMeters: 0,
      optimizedDistanceMeters: 0,
      savingsMeters: 0,
      savingsPercent: 0,
      updatedStartTimes: recalculateStartTimes(activities, activities[0]?.start_time || "09:00"),
      swapsPerformed: 0,
    };
  }

  const originalDistance = calculateTotalDistance(activities);
  let bestOrder = [...activities];
  let bestDistance = originalDistance;
  let swapsPerformed = 0;
  let improved = true;

  // Default meal windows if not specified
  const mealConstraints: OptimizationConstraints = {
    ...constraints,
    mealWindows: constraints.mealWindows || {
      lunch: { start: "11:30", end: "14:30" },
      dinner: { start: "18:30", end: "21:30" },
    },
  };

  const movableIndices = getMovableIndices(activities, mealConstraints);

  // 2-opt iterations
  const maxIterations = 100;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < bestOrder.length - 1; i++) {
      // Skip if this index can't be moved
      if (!movableIndices.has(i)) continue;

      for (let j = i + 1; j < bestOrder.length; j++) {
        // Skip if this index can't be moved
        if (!movableIndices.has(j)) continue;

        // Try 2-opt swap
        const newOrder = twoOptSwap(bestOrder, i, j);
        const newDistance = calculateTotalDistance(newOrder);

        // Check if improvement and constraints are met
        if (newDistance < bestDistance) {
          const firstStartTime = activities[0]?.start_time || "09:00";
          const newTimes = recalculateStartTimes(newOrder, firstStartTime);

          if (validateConstraints(newOrder, newTimes, mealConstraints)) {
            bestOrder = newOrder;
            bestDistance = newDistance;
            improved = true;
            swapsPerformed++;
            break;
          }
        }
      }

      if (improved) break;
    }
  }

  const savingsMeters = originalDistance - bestDistance;
  const savingsPercent = originalDistance > 0
    ? Math.round((savingsMeters / originalDistance) * 100)
    : 0;

  const firstStartTime = activities[0]?.start_time || "09:00";
  const updatedStartTimes = recalculateStartTimes(bestOrder, firstStartTime);

  return {
    originalOrder: activities,
    optimizedOrder: bestOrder,
    originalDistanceMeters: originalDistance,
    optimizedDistanceMeters: bestDistance,
    savingsMeters,
    savingsPercent,
    updatedStartTimes,
    swapsPerformed,
  };
}

// ============================================================
// BRUTE FORCE FOR SMALL SETS (Optimal solution)
// ============================================================

/**
 * Generate all permutations of an array
 */
function* permutations<T>(array: T[], n = array.length): Generator<T[]> {
  if (n <= 1) {
    yield array.slice();
  } else {
    for (let i = 0; i < n; i++) {
      yield* permutations(array, n - 1);
      const j = n % 2 === 0 ? i : 0;
      [array[n - 1], array[j]] = [array[j], array[n - 1]];
    }
  }
}

/**
 * Find optimal route using brute force (for ≤7 activities)
 */
export function optimizeRouteBruteForce(
  activities: Activity[],
  constraints: OptimizationConstraints = {}
): OptimizationResult {
  if (activities.length <= 2) {
    return optimizeRoute(activities, constraints);
  }

  // For larger sets, use 2-opt instead
  if (activities.length > 7) {
    return optimizeRoute(activities, constraints);
  }

  const originalDistance = calculateTotalDistance(activities);
  let bestOrder = activities;
  let bestDistance = originalDistance;
  let permutationsChecked = 0;

  // Get movable portion of the array
  const startIndex = constraints.keepFirstActivity ? 1 : 0;
  const endIndex = constraints.keepLastActivity ? activities.length - 1 : activities.length;

  const fixedStart = activities.slice(0, startIndex);
  const fixedEnd = activities.slice(endIndex);
  const movable = activities.slice(startIndex, endIndex);

  // Default meal windows
  const mealConstraints: OptimizationConstraints = {
    ...constraints,
    mealWindows: constraints.mealWindows || {
      lunch: { start: "11:30", end: "14:30" },
      dinner: { start: "18:30", end: "21:30" },
    },
  };

  // Try all permutations of movable section
  for (const perm of permutations([...movable])) {
    const candidate = [...fixedStart, ...perm, ...fixedEnd];
    const distance = calculateTotalDistance(candidate);
    permutationsChecked++;

    if (distance < bestDistance) {
      const firstStartTime = activities[0]?.start_time || "09:00";
      const newTimes = recalculateStartTimes(candidate, firstStartTime);

      if (validateConstraints(candidate, newTimes, mealConstraints)) {
        bestOrder = candidate;
        bestDistance = distance;
      }
    }
  }

  const savingsMeters = originalDistance - bestDistance;
  const savingsPercent = originalDistance > 0
    ? Math.round((savingsMeters / originalDistance) * 100)
    : 0;

  const firstStartTime = activities[0]?.start_time || "09:00";
  const updatedStartTimes = recalculateStartTimes(bestOrder, firstStartTime);

  return {
    originalOrder: activities,
    optimizedOrder: bestOrder,
    originalDistanceMeters: originalDistance,
    optimizedDistanceMeters: bestDistance,
    savingsMeters,
    savingsPercent,
    updatedStartTimes,
    swapsPerformed: permutationsChecked,
  };
}

// ============================================================
// NEAREST NEIGHBOR + 2-OPT (For larger sets)
// ============================================================

/**
 * Nearest neighbor heuristic for initial solution
 */
function nearestNeighborOrder(activities: Activity[], startIndex = 0): Activity[] {
  if (activities.length <= 2) return [...activities];

  const result: Activity[] = [];
  const remaining = new Set(activities.map((_, i) => i));

  // Start with the first activity
  let currentIndex = startIndex;
  result.push(activities[currentIndex]);
  remaining.delete(currentIndex);

  while (remaining.size > 0) {
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    for (const i of remaining) {
      const distance = getDistanceBetween(activities[currentIndex], activities[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    if (nearestIndex === -1) break;

    result.push(activities[nearestIndex]);
    remaining.delete(nearestIndex);
    currentIndex = nearestIndex;
  }

  return result;
}

/**
 * Hybrid approach: Nearest Neighbor + 2-opt refinement
 * Best for 8+ activities
 */
export function optimizeRouteHybrid(
  activities: Activity[],
  constraints: OptimizationConstraints = {}
): OptimizationResult {
  // Get initial solution using nearest neighbor
  const nnOrder = nearestNeighborOrder(activities, 0);

  // Refine with 2-opt
  const optimized = optimizeRoute(nnOrder, constraints);

  // Compare with original order optimized
  const originalOptimized = optimizeRoute(activities, constraints);

  // Return the better of the two
  if (optimized.optimizedDistanceMeters < originalOptimized.optimizedDistanceMeters) {
    return {
      ...optimized,
      originalOrder: activities, // Keep original order for comparison
    };
  }

  return originalOptimized;
}

// ============================================================
// MAIN EXPORT: AUTO-SELECT BEST ALGORITHM
// ============================================================

/**
 * Optimize day activities by minimizing total travel distance
 * Automatically selects the best algorithm based on number of activities
 *
 * @param activities - Array of activities for the day
 * @param constraints - Optional constraints for optimization
 * @returns Optimization result with new order and savings
 */
export function optimizeDayRoute(
  activities: Activity[],
  constraints: OptimizationConstraints = {}
): OptimizationResult {
  const n = activities.length;

  // Use brute force for small sets (guaranteed optimal)
  if (n <= 7) {
    return optimizeRouteBruteForce(activities, constraints);
  }

  // Use hybrid approach for medium sets
  if (n <= 12) {
    return optimizeRouteHybrid(activities, constraints);
  }

  // Use 2-opt for larger sets (good approximation, fast)
  return optimizeRoute(activities, constraints);
}

// ============================================================
// UTILITY EXPORTS
// ============================================================

export {
  calculateTotalDistance,
  getDistanceBetween,
  recalculateStartTimes,
  parseTimeToMinutes,
  formatMinutesToTime,
  getTravelTimeMinutes,
};
