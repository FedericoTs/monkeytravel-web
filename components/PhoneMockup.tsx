import Image from 'next/image';

interface PhoneMockupProps {
  screenImage?: string;
  className?: string;
  scale?: 'sm' | 'md' | 'lg';
}

const scaleStyles = {
  sm: 'w-48 h-auto',
  md: 'w-64 h-auto',
  lg: 'w-72 h-auto',
};

export default function PhoneMockup({
  screenImage,
  className = '',
  scale = 'lg',
}: PhoneMockupProps) {
  return (
    <div className={`relative ${scaleStyles[scale]} ${className}`}>
      {/* Phone Frame */}
      <div className="relative bg-gray-900 rounded-[2.5rem] p-2 shadow-2xl">
        {/* Inner bezel */}
        <div className="relative bg-black rounded-[2.25rem] overflow-hidden">
          {/* Dynamic Island */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-7 bg-black rounded-full z-10 flex items-center justify-center gap-3">
            <div className="w-2 h-2 rounded-full bg-gray-800" />
            <div className="w-3 h-3 rounded-full bg-gray-800 ring-1 ring-gray-700" />
          </div>

          {/* Screen content */}
          <div className="relative aspect-[9/19.5] overflow-hidden">
            {screenImage ? (
              <Image
                src={screenImage}
                alt="App screenshot"
                fill
                sizes="(max-width: 768px) 60vw, 280px"
                className="object-cover object-top"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-[var(--background-warm)] to-white">
                {/* Status bar */}
                <div className="absolute top-0 left-0 right-0 h-12 z-10 flex items-center justify-between px-8 pt-2">
                  <span className="text-xs font-semibold text-gray-900">9:41</span>
                  <div className="flex items-center gap-1">
                    <svg className="w-4 h-4 text-gray-900" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                    </svg>
                    <svg className="w-4 h-4 text-gray-900" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17 4h-3V2h-4v2H7v18h10V4zm-4 16h-2v-2h2v2zm0-4h-2V9h2v7z" />
                    </svg>
                    <div className="w-7 h-3 bg-gray-900 rounded-sm relative">
                      <div className="absolute inset-y-0.5 left-0.5 right-1 bg-green-500 rounded-sm" />
                    </div>
                  </div>
                </div>

                {/* App Content */}
                <div className="absolute inset-0 pt-14 p-4">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <div className="w-16 h-2 bg-gray-300 rounded mb-1.5" />
                      <div className="w-28 h-3 bg-gray-400 rounded" />
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-dark)] flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--primary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="w-full h-10 bg-gray-100 rounded-xl flex items-center px-4 gap-3 mb-5">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <div className="w-20 h-2 bg-gray-300 rounded" />
                  </div>

                  {/* Featured Card */}
                  <div className="w-full aspect-[16/10] bg-gradient-to-br from-[var(--primary)] via-[var(--primary-light)] to-[var(--primary)] rounded-2xl p-4 flex flex-col justify-end mb-4 shadow-lg relative overflow-hidden">
                    <div className="absolute top-3 right-3 px-2 py-1 bg-white/20 rounded-full">
                      <div className="w-10 h-2 bg-white/60 rounded" />
                    </div>
                    <div className="w-2/3 h-3.5 bg-white/50 rounded mb-1.5" />
                    <div className="w-1/2 h-2.5 bg-white/30 rounded" />
                  </div>

                  {/* Quick Actions */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="aspect-square bg-white rounded-xl flex flex-col items-center justify-center gap-1.5 shadow-sm border border-gray-100">
                        <div className={`w-7 h-7 rounded-lg ${i === 1 ? 'bg-[var(--accent)]/30' : i === 2 ? 'bg-[var(--primary)]/20' : 'bg-gray-100'}`} />
                        <div className="w-8 h-1.5 bg-gray-200 rounded" />
                      </div>
                    ))}
                  </div>

                  {/* Activity List */}
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm border border-gray-50">
                        <div className={`w-9 h-9 rounded-xl ${i === 1 ? 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-dark)]' : 'bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)]'}`} />
                        <div className="flex-1">
                          <div className="w-16 h-2 bg-gray-300 rounded mb-1" />
                          <div className="w-12 h-1.5 bg-gray-200 rounded" />
                        </div>
                        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom Nav Indicator */}
                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                  <div className="w-28 h-1 bg-gray-900 rounded-full" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side buttons */}
        <div className="absolute left-0 top-28 w-0.5 h-6 bg-gray-700 rounded-l" />
        <div className="absolute left-0 top-40 w-0.5 h-10 bg-gray-700 rounded-l" />
        <div className="absolute left-0 top-52 w-0.5 h-10 bg-gray-700 rounded-l" />
        <div className="absolute right-0 top-36 w-0.5 h-14 bg-gray-700 rounded-r" />
      </div>
    </div>
  );
}
