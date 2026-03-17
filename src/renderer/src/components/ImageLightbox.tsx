import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const total = images.length;
  const hasMultiple = total > 1;

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % total);
  }, [total]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasMultiple) goPrev();
      else if (e.key === 'ArrowRight' && hasMultiple) goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext, hasMultiple]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-[110] rounded-full bg-white/10 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
      >
        <X className="size-5" />
      </button>

      {/* Counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev arrow */}
      {hasMultiple && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-3 z-[110] rounded-full bg-white/10 p-2.5 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      {/* Image */}
      <img
        src={images[index]}
        alt={`Image ${index + 1}`}
        className="relative z-[105] max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Next arrow */}
      {hasMultiple && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-3 z-[110] rounded-full bg-white/10 p-2.5 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
        >
          <ChevronRight className="size-5" />
        </button>
      )}
    </div>
  );
}

// Hook for managing lightbox state
export function useLightbox() {
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  const openLightbox = useCallback((images: string[], index: number) => {
    setLightbox({ images, index });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  return { lightbox, openLightbox, closeLightbox };
}
