import Image from 'next/image';

interface TestimonialCardProps {
  quote: string;
  author: string;
  role: string;
  avatar?: string;
  rating?: number;
  className?: string;
}

export default function TestimonialCard({
  quote,
  author,
  role,
  avatar,
  rating = 5,
  className = '',
}: TestimonialCardProps) {
  return (
    <div
      className={`p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-shadow ${className}`}
    >
      {/* Rating Stars */}
      <div className="flex gap-1 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg
            key={i}
            className={`w-5 h-5 ${i < rating ? 'text-[var(--accent)]' : 'text-gray-200'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>

      {/* Quote */}
      <blockquote className="text-[var(--foreground)] leading-relaxed mb-6">
        &ldquo;{quote}&rdquo;
      </blockquote>

      {/* Author */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center overflow-hidden">
          {avatar ? (
            <Image src={avatar} alt={author} width={48} height={48} className="object-cover" />
          ) : (
            <span className="text-[var(--primary)] font-bold text-lg">
              {author.charAt(0)}
            </span>
          )}
        </div>
        <div>
          <p className="font-semibold text-[var(--foreground)]">{author}</p>
          <p className="text-sm text-[var(--foreground-muted)]">{role}</p>
        </div>
      </div>
    </div>
  );
}
