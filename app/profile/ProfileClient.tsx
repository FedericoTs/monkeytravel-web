"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { createClient } from "@/lib/supabase/client";

// Types
interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  home_country: string;
  home_city: string;
  date_of_birth: string | null;
  languages: string[];
  preferences: Record<string, unknown>;
  notification_settings: NotificationSettings;
  privacy_settings: PrivacySettings;
  created_at: string;
  last_sign_in_at: string | null;
}

interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  tripReminders: boolean;
  dealAlerts: boolean;
  socialNotifications: boolean;
  marketingNotifications: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
}

interface PrivacySettings {
  privateProfile: boolean;
  showRealName: boolean;
  showTripHistory: boolean;
  showActivityStatus: boolean;
  showLocation: boolean;
  allowLocationTracking: boolean;
  disableFriendRequests: boolean;
}

interface TripStats {
  totalTrips: number;
  countriesVisited: number;
  totalTravelDays: number;
  upcomingTrips: number;
}

interface ProfileClientProps {
  profile: UserProfile;
  stats: TripStats;
}

// Section component for expandable sections
function ProfileSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden transition-shadow hover:shadow-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 sm:p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)]/10 to-[var(--secondary)]/10 flex items-center justify-center text-[var(--primary)]">
            {icon}
          </div>
          <span className="font-semibold text-[var(--foreground)]">{title}</span>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="px-4 sm:px-5 pb-5 pt-0 border-t border-slate-100">
          {children}
        </div>
      </div>
    </div>
  );
}

// Toggle switch component
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-4 py-3 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">
          {label}
        </div>
        {description && (
          <div className="text-sm text-slate-500 mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${
          checked ? "bg-[var(--primary)]" : "bg-slate-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

// Editable field component
function EditableField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "textarea" | "email" | "date";
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const baseClasses =
    "w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-[var(--foreground)] placeholder-slate-400 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 focus:bg-white transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-600">{label}</label>
      {type === "textarea" ? (
        <div className="relative">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={disabled}
            rows={3}
            className={`${baseClasses} resize-none`}
          />
          {maxLength && (
            <span className="absolute bottom-2 right-3 text-xs text-slate-400">
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className={baseClasses}
        />
      )}
    </div>
  );
}

export default function ProfileClient({ profile: initialProfile, stats }: ProfileClientProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle avatar upload
  const handleAvatarUpload = useCallback(async (file: File) => {
    setUploadingAvatar(true);
    setSaveStatus("saving");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to upload avatar");
      }

      setProfile((prev) => ({ ...prev, avatar_url: data.avatar_url }));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("Avatar upload error:", error);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setUploadingAvatar(false);
    }
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAvatarUpload(file);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  }, [handleAvatarUpload]);

  // Update profile field
  const updateField = useCallback(
    async (field: string, value: unknown) => {
      setProfile((prev) => ({ ...prev, [field]: value }));
      setSaveStatus("saving");

      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("users")
          .update({ [field]: value, updated_at: new Date().toISOString() })
          .eq("id", profile.id);

        if (error) throw error;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [profile.id]
  );

  // Update nested settings
  const updateSettings = useCallback(
    async (settingsKey: "notification_settings" | "privacy_settings", updates: Record<string, unknown>) => {
      const currentSettings = profile[settingsKey];
      const newSettings = { ...currentSettings, ...updates };

      setProfile((prev) => ({ ...prev, [settingsKey]: newSettings as typeof currentSettings }));
      setSaveStatus("saving");

      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("users")
          .update({ [settingsKey]: newSettings, updated_at: new Date().toISOString() })
          .eq("id", profile.id);

        if (error) throw error;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [profile]
  );

  // Sign out
  const handleSignOut = async () => {
    setSaving(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  // Format member since date
  const memberSince = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Get initials for avatar fallback
  const initials = profile.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--background-warm)] to-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/trips"
            className="flex items-center gap-2 text-slate-600 hover:text-[var(--primary)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="font-medium">Back</span>
          </Link>
          <h1 className="text-lg font-bold text-[var(--foreground)]">Profile</h1>
          <div className="w-16 flex justify-end">
            {/* Save status indicator */}
            <div
              className={`text-xs font-medium px-2 py-1 rounded-full transition-all duration-300 ${
                saveStatus === "saving"
                  ? "bg-amber-100 text-amber-700"
                  : saveStatus === "saved"
                  ? "bg-green-100 text-green-700"
                  : saveStatus === "error"
                  ? "bg-red-100 text-red-700"
                  : "opacity-0"
              }`}
            >
              {saveStatus === "saving" && "Saving..."}
              {saveStatus === "saved" && "Saved"}
              {saveStatus === "error" && "Error"}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-28 space-y-6">
        {/* Profile Header Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-100 relative overflow-hidden">
          {/* Decorative gradient */}
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-[var(--primary)]/10 via-[var(--secondary)]/5 to-transparent rounded-bl-full" />

          <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-5">
            {/* Avatar */}
            <div className="relative group">
              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] shadow-lg shadow-[var(--primary)]/20">
                {profile.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={profile.display_name}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold">
                    {initials}
                  </div>
                )}
                {/* Upload loading overlay */}
                {uploadingAvatar && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-2xl">
                    <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
              {/* Edit overlay */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center disabled:cursor-not-allowed"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Info */}
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-2xl font-bold text-[var(--foreground)]">
                {profile.display_name}
              </h2>
              <p className="text-slate-500 mt-1">{profile.email}</p>
              <div className="flex items-center justify-center sm:justify-start gap-2 mt-2 text-sm text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Member since {memberSince}</span>
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-4 gap-2 sm:gap-4">
            <StatItem value={stats.totalTrips} label="Trips" icon="map" />
            <StatItem value={stats.upcomingTrips} label="Upcoming" icon="calendar" />
            <StatItem value={stats.countriesVisited} label="Places" icon="globe" />
            <StatItem value={stats.totalTravelDays} label="Days" icon="sun" />
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-3">
          {/* Personal Info */}
          <ProfileSection
            title="Personal Info"
            defaultOpen={true}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          >
            <div className="space-y-4 pt-4">
              <EditableField
                label="Display Name"
                value={profile.display_name}
                onChange={(value) => updateField("display_name", value)}
                placeholder="Your name"
                maxLength={50}
              />
              <EditableField
                label="Bio"
                value={profile.bio}
                onChange={(value) => updateField("bio", value)}
                type="textarea"
                placeholder="Tell us about yourself and your travel style..."
                maxLength={200}
              />
              <EditableField
                label="Email"
                value={profile.email}
                onChange={() => {}}
                type="email"
                disabled
              />
              <div className="grid grid-cols-2 gap-4">
                <EditableField
                  label="Home Country"
                  value={profile.home_country}
                  onChange={(value) => updateField("home_country", value)}
                  placeholder="e.g., Italy"
                />
                <EditableField
                  label="Home City"
                  value={profile.home_city}
                  onChange={(value) => updateField("home_city", value)}
                  placeholder="e.g., Milan"
                />
              </div>
            </div>
          </ProfileSection>

          {/* Travel Preferences */}
          <ProfileSection
            title="Travel Preferences"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          >
            <div className="pt-4">
              <p className="text-slate-500 text-sm mb-4">
                Your preferences help us create better trip recommendations.
              </p>

              {/* Travel Style Tags */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-600">Travel Style</label>
                <div className="flex flex-wrap gap-2">
                  {["Adventure", "Relaxation", "Cultural", "Foodie", "Romantic", "Budget", "Luxury", "Solo", "Family"].map((style) => {
                    const styleLower = style.toLowerCase();
                    const currentStyles = (profile.preferences?.travelStyles as string[] | undefined) || [];
                    const isSelected = currentStyles.includes(styleLower);
                    return (
                      <button
                        key={style}
                        onClick={() => {
                          const newStyles = isSelected
                            ? currentStyles.filter((s) => s !== styleLower)
                            : [...currentStyles, styleLower];
                          updateField("preferences", { ...profile.preferences, travelStyles: newStyles });
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                          isSelected
                            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                            : "border-slate-200 text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dietary */}
              <div className="mt-6 space-y-3">
                <label className="block text-sm font-medium text-slate-600">Dietary Preferences</label>
                <div className="flex flex-wrap gap-2">
                  {["Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-Free", "No Restrictions"].map((diet) => {
                    const dietLower = diet.toLowerCase().replace(" ", "-");
                    const currentDiets = (profile.preferences?.dietaryPreferences as string[] | undefined) || [];
                    const isSelected = currentDiets.includes(dietLower);
                    return (
                      <button
                        key={diet}
                        onClick={() => {
                          const newDiets = isSelected
                            ? currentDiets.filter((d) => d !== dietLower)
                            : [...currentDiets, dietLower];
                          updateField("preferences", { ...profile.preferences, dietaryPreferences: newDiets });
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                          isSelected
                            ? "border-[var(--secondary)] bg-[var(--secondary)] text-white"
                            : "border-slate-200 text-slate-600 hover:border-[var(--secondary)] hover:text-[var(--secondary)]"
                        }`}
                      >
                        {diet}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </ProfileSection>

          {/* Notifications */}
          <ProfileSection
            title="Notifications"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
          >
            <div className="pt-2 divide-y divide-slate-100">
              <Toggle
                label="Email Notifications"
                description="Receive updates via email"
                checked={profile.notification_settings.emailNotifications}
                onChange={(checked) =>
                  updateSettings("notification_settings", { emailNotifications: checked })
                }
              />
              <Toggle
                label="Push Notifications"
                description="Get alerts on your device"
                checked={profile.notification_settings.pushNotifications}
                onChange={(checked) =>
                  updateSettings("notification_settings", { pushNotifications: checked })
                }
              />
              <Toggle
                label="Trip Reminders"
                description="Upcoming trip alerts and check-in reminders"
                checked={profile.notification_settings.tripReminders}
                onChange={(checked) =>
                  updateSettings("notification_settings", { tripReminders: checked })
                }
              />
              <Toggle
                label="Deal Alerts"
                description="Price drops and special offers"
                checked={profile.notification_settings.dealAlerts}
                onChange={(checked) =>
                  updateSettings("notification_settings", { dealAlerts: checked })
                }
              />
              <Toggle
                label="Social Updates"
                description="When someone follows you or comments"
                checked={profile.notification_settings.socialNotifications}
                onChange={(checked) =>
                  updateSettings("notification_settings", { socialNotifications: checked })
                }
              />
              <Toggle
                label="Marketing & Tips"
                description="Travel inspiration and product updates"
                checked={profile.notification_settings.marketingNotifications}
                onChange={(checked) =>
                  updateSettings("notification_settings", { marketingNotifications: checked })
                }
              />
            </div>
          </ProfileSection>

          {/* Privacy */}
          <ProfileSection
            title="Privacy"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            }
          >
            <div className="pt-2 divide-y divide-slate-100">
              <Toggle
                label="Private Profile"
                description="Only you can see your profile and trips"
                checked={profile.privacy_settings.privateProfile}
                onChange={(checked) =>
                  updateSettings("privacy_settings", { privateProfile: checked })
                }
              />
              <Toggle
                label="Show Real Name"
                description="Display your name publicly instead of username"
                checked={profile.privacy_settings.showRealName}
                onChange={(checked) =>
                  updateSettings("privacy_settings", { showRealName: checked })
                }
              />
              <Toggle
                label="Show Trip History"
                description="Let others see your past trips"
                checked={profile.privacy_settings.showTripHistory}
                onChange={(checked) =>
                  updateSettings("privacy_settings", { showTripHistory: checked })
                }
              />
              <Toggle
                label="Activity Status"
                description="Show when you're online"
                checked={profile.privacy_settings.showActivityStatus}
                onChange={(checked) =>
                  updateSettings("privacy_settings", { showActivityStatus: checked })
                }
              />
              <Toggle
                label="Location Tracking"
                description="Enable location-based features and recommendations"
                checked={profile.privacy_settings.allowLocationTracking}
                onChange={(checked) =>
                  updateSettings("privacy_settings", { allowLocationTracking: checked })
                }
              />
            </div>
          </ProfileSection>

          {/* Account */}
          <ProfileSection
            title="Account"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          >
            <div className="pt-4 space-y-3">
              {/* Sign Out */}
              <button
                onClick={() => setShowSignOutConfirm(true)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span className="font-medium text-slate-700">Sign Out</span>
                </div>
                <svg className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Danger Zone */}
              <div className="mt-6 pt-4 border-t border-slate-200">
                <h4 className="text-sm font-medium text-red-600 mb-3">Danger Zone</h4>
                <button className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-red-200 hover:border-red-300 hover:bg-red-50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="font-medium text-red-600">Delete Account</span>
                  </div>
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </ProfileSection>
        </div>

        {/* App Info */}
        <div className="text-center py-6 text-sm text-slate-400">
          <p>MonkeyTravel v1.0</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <Link href="/privacy" className="hover:text-[var(--primary)] transition-colors">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-[var(--primary)] transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </main>

      {/* Sign Out Confirmation Modal */}
      {showSignOutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowSignOutConfirm(false)}
          />
          <div className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-[var(--foreground)]">Sign Out?</h3>
              <p className="text-slate-500 mt-2">
                Are you sure you want to sign out of your account?
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="flex-1 px-4 py-3 rounded-xl font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                disabled={saving}
                className="flex-1 px-4 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav activePage="profile" />
    </div>
  );
}

// Stat item component
function StatItem({
  value,
  label,
  icon,
}: {
  value: number;
  label: string;
  icon: "map" | "calendar" | "globe" | "sun";
}) {
  const icons = {
    map: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    ),
    calendar: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    ),
    globe: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
    sun: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    ),
  };

  return (
    <div className="text-center">
      <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
        <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icons[icon]}
        </svg>
      </div>
      <div className="text-xl font-bold text-[var(--foreground)]">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
