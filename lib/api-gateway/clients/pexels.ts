/**
 * Pexels API Client
 *
 * Pre-configured client for Pexels image API.
 * Free API, but tracked for analytics.
 */

import { apiGateway } from "../client";
import { PEXELS_API_BASE } from "@/lib/constants/externalApis";

const PEXELS_BASE = PEXELS_API_BASE;

/**
 * Pexels Image API
 */
export const pexelsApi = {
  /**
   * Search for photos
   */
  async searchPhotos(
    query: string,
    options: {
      userId?: string;
      perPage?: number;
      page?: number;
      orientation?: "landscape" | "portrait" | "square";
      size?: "small" | "medium" | "large";
    } = {}
  ) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

    const url = new URL(`${PEXELS_BASE}/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", (options.perPage || 10).toString());
    url.searchParams.set("page", (options.page || 1).toString());
    if (options.orientation) {
      url.searchParams.set("orientation", options.orientation);
    }
    if (options.size) {
      url.searchParams.set("size", options.size);
    }

    const { data } = await apiGateway.fetch<{
      page: number;
      per_page: number;
      total_results: number;
      photos: Array<{
        id: number;
        width: number;
        height: number;
        url: string;
        photographer: string;
        photographer_url: string;
        src: {
          original: string;
          large2x: string;
          large: string;
          medium: string;
          small: string;
          portrait: string;
          landscape: string;
          tiny: string;
        };
        alt: string;
      }>;
    }>(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: apiKey,
        },
      },
      {
        apiName: "pexels",
        endpoint: "/search",
        userId: options.userId,
        costOverride: 0, // Free API
        metadata: { query, perPage: options.perPage, page: options.page },
      }
    );

    return data;
  },

  /**
   * Get curated photos
   */
  async getCurated(
    options: {
      userId?: string;
      perPage?: number;
      page?: number;
    } = {}
  ) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

    const url = new URL(`${PEXELS_BASE}/curated`);
    url.searchParams.set("per_page", (options.perPage || 10).toString());
    url.searchParams.set("page", (options.page || 1).toString());

    const { data } = await apiGateway.fetch<{
      page: number;
      per_page: number;
      photos: Array<{
        id: number;
        width: number;
        height: number;
        url: string;
        photographer: string;
        src: {
          original: string;
          large2x: string;
          large: string;
          medium: string;
          small: string;
        };
        alt: string;
      }>;
    }>(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: apiKey,
        },
      },
      {
        apiName: "pexels",
        endpoint: "/curated",
        userId: options.userId,
        costOverride: 0, // Free API
        metadata: { perPage: options.perPage, page: options.page },
      }
    );

    return data;
  },

  /**
   * Get a single photo by ID
   */
  async getPhoto(
    photoId: number,
    options: { userId?: string } = {}
  ) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error("PEXELS_API_KEY not configured");

    const { data } = await apiGateway.fetch<{
      id: number;
      width: number;
      height: number;
      url: string;
      photographer: string;
      photographer_url: string;
      src: {
        original: string;
        large2x: string;
        large: string;
        medium: string;
        small: string;
        portrait: string;
        landscape: string;
        tiny: string;
      };
      alt: string;
    }>(
      `${PEXELS_BASE}/photos/${photoId}`,
      {
        method: "GET",
        headers: {
          Authorization: apiKey,
        },
      },
      {
        apiName: "pexels",
        endpoint: `/photos/${photoId}`,
        userId: options.userId,
        costOverride: 0, // Free API
        metadata: { photoId },
      }
    );

    return data;
  },
};
