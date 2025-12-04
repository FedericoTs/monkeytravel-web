"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

interface CarouselImage {
  url: string;
  thumbnailUrl?: string;
  alt?: string;
  attribution?: string;
}

interface ImageCarouselProps {
  images: CarouselImage[];
  initialIndex?: number;
  onClose: () => void;
  placeName?: string;
}

export default function ImageCarousel({
  images,
  initialIndex = 0,
  onClose,
  placeName,
}: ImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isAnimating, setIsAnimating] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Touch tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);

  // Pinch zoom refs
  const initialPinchDistance = useRef(0);
  const initialZoomScale = useRef(1);
  const isPinching = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Prevent body scroll when carousel is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Reset state when image changes
  useEffect(() => {
    setImageLoaded(false);
    setIsZoomed(false);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, [currentIndex]);

  // Auto-scroll thumbnail into view when index changes
  useEffect(() => {
    if (thumbnailContainerRef.current) {
      const container = thumbnailContainerRef.current;
      const thumbnails = container.querySelectorAll('button');
      const activeThumbnail = thumbnails[currentIndex];

      if (activeThumbnail) {
        const containerRect = container.getBoundingClientRect();
        const thumbnailRect = activeThumbnail.getBoundingClientRect();

        // Calculate scroll position to center the thumbnail
        const scrollLeft = activeThumbnail.offsetLeft - (containerRect.width / 2) + (thumbnailRect.width / 2);

        container.scrollTo({
          left: scrollLeft,
          behavior: 'smooth'
        });
      }
    }
  }, [currentIndex]);

  // Entry animation
  useEffect(() => {
    const timer = setTimeout(() => setIsAnimating(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" && !isZoomed) {
        goToNext();
      } else if (e.key === "ArrowLeft" && !isZoomed) {
        goToPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isZoomed, onClose]);

  const goToNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, images.length]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const getDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      isPinching.current = true;
      initialPinchDistance.current = getDistance(e.touches);
      initialZoomScale.current = zoomScale;
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
      setIsDragging(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current) {
      // Pinch zoom
      const distance = getDistance(e.touches);
      const scale = (distance / initialPinchDistance.current) * initialZoomScale.current;
      const newScale = Math.min(Math.max(scale, 1), 4);
      setZoomScale(newScale);
      setIsZoomed(newScale > 1.1);
      return;
    }

    if (e.touches.length === 1 && isDragging) {
      const touch = e.touches[0];
      const deltaX = touch.clientX - lastTouchRef.current.x;
      const deltaY = touch.clientY - lastTouchRef.current.y;

      if (isZoomed) {
        // Pan when zoomed
        setPanOffset((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
      } else {
        // Swipe navigation
        const totalDeltaX = touch.clientX - touchStartRef.current.x;
        setDragOffset(totalDeltaX);

        // Calculate velocity
        const timeDelta = Date.now() - touchStartRef.current.time;
        if (timeDelta > 0) {
          velocityRef.current = totalDeltaX / timeDelta;
        }
      }

      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleTouchEnd = () => {
    isPinching.current = false;

    if (!isDragging) return;
    setIsDragging(false);

    if (isZoomed) {
      // Reset zoom if scale is close to 1
      if (zoomScale < 1.1) {
        setIsZoomed(false);
        setZoomScale(1);
        setPanOffset({ x: 0, y: 0 });
      }
      return;
    }

    const threshold = 50;
    const velocityThreshold = 0.3;
    const swipeDistance = dragOffset;
    const velocity = velocityRef.current;

    // Determine if we should navigate
    if (swipeDistance > threshold || velocity > velocityThreshold) {
      if (currentIndex > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
    } else if (swipeDistance < -threshold || velocity < -velocityThreshold) {
      if (currentIndex < images.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      }
    }

    // Reset drag
    setDragOffset(0);
    velocityRef.current = 0;
  };

  const handleDoubleTap = () => {
    if (isZoomed) {
      setIsZoomed(false);
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setIsZoomed(true);
      setZoomScale(2);
    }
  };

  // Double tap detection
  const lastTapRef = useRef(0);
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      handleDoubleTap();
    }
    lastTapRef.current = now;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!mounted) return null;

  const currentImage = images[currentIndex];

  const carouselContent = (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[9999] flex flex-col transition-opacity duration-300 ${
        isAnimating ? "opacity-0" : "opacity-100"
      }`}
      style={{
        background: "linear-gradient(180deg, rgba(0,0,0,0.98) 0%, rgba(10,10,15,0.99) 100%)",
      }}
      onClick={handleBackdropClick}
    >
      {/* Ambient glow effect */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background: `radial-gradient(ellipse at center, rgba(255,255,255,0.05) 0%, transparent 70%)`,
        }}
      />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="group flex items-center gap-2 px-3 py-2 -ml-2 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 backdrop-blur-xl border border-white/10 transition-all duration-200"
          aria-label="Close gallery"
        >
          <svg className="w-5 h-5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="hidden sm:inline text-sm font-medium text-white/80 group-hover:text-white">
            Close
          </span>
        </button>

        {/* Title and Attribution */}
        {placeName && (
          <div className="absolute left-1/2 -translate-x-1/2 text-center">
            <h2 className="text-sm sm:text-base font-medium text-white/90 truncate max-w-[200px] sm:max-w-none">
              {placeName}
            </h2>
            {currentImage.attribution && (
              <p className="text-[10px] text-white/40 mt-0.5 truncate max-w-[180px] sm:max-w-none">
                Photo: {currentImage.attribution}
              </p>
            )}
          </div>
        )}

        {/* Counter */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-xl border border-white/10">
            <span className="text-sm font-medium text-white/90">
              {currentIndex + 1}
            </span>
            <span className="text-white/40 mx-1">/</span>
            <span className="text-sm text-white/60">{images.length}</span>
          </div>
        </div>
      </header>

      {/* Main image area */}
      <div
        className="flex-1 relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleTap}
      >
        {/* Navigation arrows - desktop */}
        {images.length > 1 && !isZoomed && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrev();
              }}
              disabled={currentIndex === 0}
              className={`hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all duration-200 ${
                currentIndex === 0 ? "opacity-30 cursor-not-allowed" : "hover:scale-105"
              }`}
              aria-label="Previous image"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              disabled={currentIndex === images.length - 1}
              className={`hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all duration-200 ${
                currentIndex === images.length - 1 ? "opacity-30 cursor-not-allowed" : "hover:scale-105"
              }`}
              aria-label="Next image"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Image container with swipe animation */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: isZoomed
              ? `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`
              : `translateX(${dragOffset}px)`,
            transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          }}
        >
          {/* Loading skeleton */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-6 h-6 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={currentImage.url}
            alt={currentImage.alt || `Photo ${currentIndex + 1}`}
            className={`max-w-full max-h-full object-contain select-none transition-opacity duration-300 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            style={{
              maxWidth: "95vw",
              maxHeight: "calc(100vh - 200px)",
            }}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />
        </div>


        {/* Zoom indicator */}
        {isZoomed && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10">
            <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
            <span className="text-xs text-white/70">{Math.round(zoomScale * 100)}%</span>
          </div>
        )}
      </div>

      {/* Premium Bottom Navigation */}
      <div className="relative z-20 pb-safe">
        {/* iOS-style progress bar - shows position in gallery */}
        {images.length > 1 && (
          <div className="flex justify-center pb-3">
            <div className="relative h-[3px] w-20 rounded-full bg-white/20 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${((currentIndex + 1) / images.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Premium Thumbnail Strip */}
        <div className="mx-3 sm:mx-4 mb-3 sm:mb-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 overflow-hidden">
          <div
            ref={thumbnailContainerRef}
            className="flex gap-2 sm:gap-3 p-2.5 sm:p-3 overflow-x-auto scrollbar-hide"
            style={{
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {images.map((image, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`group relative flex-shrink-0 transition-all duration-300 ease-out ${
                  idx === currentIndex
                    ? "scale-110 z-10"
                    : "scale-100 opacity-60 hover:opacity-90 active:scale-95"
                }`}
                style={{ scrollSnapAlign: "center" }}
                aria-label={`View photo ${idx + 1}`}
              >
                {/* Thumbnail container */}
                <div
                  className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden transition-all duration-300 ${
                    idx === currentIndex
                      ? "ring-2 ring-white shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                      : "ring-1 ring-white/20"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.thumbnailUrl || image.url}
                    alt={`Thumbnail ${idx + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />

                  {/* Gradient overlay for inactive */}
                  {idx !== currentIndex && (
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-200" />
                  )}

                  {/* Active glow effect */}
                  {idx === currentIndex && (
                    <div className="absolute inset-0 bg-gradient-to-t from-white/10 to-transparent" />
                  )}
                </div>

                {/* Active indicator dot */}
                {idx === currentIndex && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(carouselContent, document.body);
}
