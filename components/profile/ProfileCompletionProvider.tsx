"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import ProfileCompletionModal from "./ProfileCompletionModal";

interface ProfileCompletionContextType {
  showProfileModal: () => void;
  hideProfileModal: () => void;
  isProfileComplete: boolean;
}

const ProfileCompletionContext = createContext<ProfileCompletionContextType | undefined>(
  undefined
);

export function useProfileCompletion() {
  const context = useContext(ProfileCompletionContext);
  if (!context) {
    throw new Error("useProfileCompletion must be used within ProfileCompletionProvider");
  }
  return context;
}

interface ProfileCompletionProviderProps {
  children: ReactNode;
}

interface UserProfileData {
  login_count: number;
  profile_completed: boolean;
  display_name: string;
  home_country: string;
  home_city: string;
  languages: string[];
  bio: string;
}

export default function ProfileCompletionProvider({
  children,
}: ProfileCompletionProviderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileComplete, setIsProfileComplete] = useState(true); // Default to true to prevent flash
  const [profileData, setProfileData] = useState<Partial<UserProfileData>>({});
  const [hasChecked, setHasChecked] = useState(false);
  // Task #181 cleanup: read auth from the single AuthProvider. We still own
  // the per-session sessionStorage gate and the post-mount DB lookup — only
  // the "who's the current user?" question is delegated to the context.
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    // Defer the check until the central AuthProvider has resolved — otherwise
    // we'd mark logged-in users as anonymous on first paint and skip the
    // completion prompt entirely.
    if (authLoading) return;
    checkProfileCompletion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const checkProfileCompletion = async () => {
    // Check if we've already shown the modal this session
    if (typeof window !== "undefined") {
      const shownThisSession = sessionStorage.getItem("profile_modal_shown");
      if (shownThisSession === "true") {
        setHasChecked(true);
        return;
      }
    }

    try {
      if (!user) {
        setHasChecked(true);
        return;
      }

      const supabase = createClient();
      const { data: profile } = await supabase
        .from("users")
        .select("login_count, profile_completed, display_name, home_country, home_city, languages, bio")
        .eq("id", user.id)
        .single();

      if (!profile) {
        setHasChecked(true);
        return;
      }

      setIsProfileComplete(profile.profile_completed || false);
      setProfileData({
        login_count: profile.login_count || 0,
        profile_completed: profile.profile_completed || false,
        display_name: profile.display_name || "",
        home_country: profile.home_country || "",
        home_city: profile.home_city || "",
        languages: profile.languages || [],
        bio: profile.bio || "",
      });

      // Show modal if:
      // 1. User has logged in at least 2 times (returning user)
      // 2. Profile is not yet completed
      // 3. Not shown this session yet
      const shouldShow =
        (profile.login_count || 0) >= 2 &&
        !profile.profile_completed;

      if (shouldShow) {
        // Small delay to let the page render first
        setTimeout(() => {
          setIsModalOpen(true);
        }, 1500);
      }
    } catch (error) {
      console.error("Error checking profile completion:", error);
    } finally {
      setHasChecked(true);
    }
  };

  const showProfileModal = () => {
    setIsModalOpen(true);
  };

  const hideProfileModal = () => {
    setIsModalOpen(false);
  };

  const handleComplete = () => {
    setIsProfileComplete(true);
    setIsModalOpen(false);
  };

  const contextValue: ProfileCompletionContextType = {
    showProfileModal,
    hideProfileModal,
    isProfileComplete,
  };

  return (
    <ProfileCompletionContext.Provider value={contextValue}>
      {children}
      {hasChecked && (
        <ProfileCompletionModal
          isOpen={isModalOpen}
          onClose={hideProfileModal}
          onComplete={handleComplete}
          initialData={{
            display_name: profileData.display_name,
            home_country: profileData.home_country,
            home_city: profileData.home_city,
            languages: profileData.languages,
            bio: profileData.bio,
          }}
        />
      )}
    </ProfileCompletionContext.Provider>
  );
}
