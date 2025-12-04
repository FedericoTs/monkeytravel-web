# Profile Page Implementation Plan

## Executive Summary

Create a comprehensive, mobile-first profile management page for MonkeyTravel that allows users to view and edit their personal information, travel preferences, notification settings, and privacy controls. Based on UX research and existing app patterns.

---

## Database Schema (Already Exists)

The `users` table supports:
- **Identity**: `display_name`, `email`, `avatar_url`, `bio`
- **Location**: `home_country`, `home_city`, `current_location`, `current_city`, `current_country`
- **Personal**: `date_of_birth`, `languages[]`
- **Preferences**: `preferences` (JSONB) - travel style, budget, dietary, etc.
- **Settings**: `notification_settings` (JSONB), `privacy_settings` (JSONB)
- **Stats**: `stats` (JSONB), `created_at`, `last_sign_in_at`

---

## Architecture

### Route Structure
```
/profile                     → Main profile page (overview)
/profile/edit                → Edit personal info (sheet/modal on mobile)
/profile/preferences         → Travel preferences
/profile/notifications       → Notification settings
/profile/privacy             → Privacy controls
/profile/account             → Account management (password, delete)
```

**Alternative (Recommended)**: Single page with tabbed sections or accordion for mobile simplicity.

### Components to Create

```
app/
└── profile/
    ├── page.tsx                 # Server component - fetch user data
    └── ProfileClient.tsx        # Client component - all UI

components/
└── profile/
    ├── ProfileHeader.tsx        # Avatar, name, stats banner
    ├── ProfileSection.tsx       # Reusable section wrapper
    ├── PersonalInfoForm.tsx     # Edit name, bio, location
    ├── TravelPreferences.tsx    # Vibes, budget, dietary
    ├── NotificationSettings.tsx # Toggle switches
    ├── PrivacySettings.tsx      # Privacy toggles
    ├── AccountDangerZone.tsx    # Sign out, delete account
    └── AvatarUpload.tsx         # Image upload with crop
```

---

## UI Design Specification

### Layout (Mobile-First)

```
┌─────────────────────────────────┐
│ ← Profile                    ⚙️ │  Header with back + settings
├─────────────────────────────────┤
│         ┌───────┐               │
│         │ 👤    │               │  Avatar (96x96px, tap to edit)
│         └───────┘               │
│       Display Name              │
│       @username • Member since  │
├─────────────────────────────────┤
│  📊 Trip Stats (horizontal)     │
│  [12 Trips] [5 Countries] [42d] │
├─────────────────────────────────┤
│                                 │
│  📝 Personal Info          [→]  │  Expandable/navigable sections
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  🎒 Travel Preferences     [→]  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  🔔 Notifications          [→]  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  🔒 Privacy                [→]  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  🚪 Account                [→]  │
│                                 │
├─────────────────────────────────┤
│   [Home] [Trips] [+] [Profile]  │  Bottom nav (Profile active)
└─────────────────────────────────┘
```

### Section Details

#### 1. Personal Info
- Display name (editable)
- Bio (textarea, 150 char limit)
- Email (read-only, show verified badge)
- Date of birth (optional)
- Home location (country + city)
- Languages spoken (multi-select)

#### 2. Travel Preferences
- Travel vibes (reuse VibeSelector from trip creation)
- Budget range (budget/mid/luxury)
- Dietary restrictions (vegetarian, vegan, halal, kosher, allergies)
- Accessibility needs (wheelchair, hearing, vision aids)
- Preferred accommodation types

#### 3. Notification Settings
```typescript
{
  emailNotifications: boolean,      // Master email toggle
  pushNotifications: boolean,       // Master push toggle
  tripReminders: boolean,           // Upcoming trip alerts
  dealAlerts: boolean,              // Price drops, deals
  socialNotifications: boolean,     // Follows, comments
  marketingNotifications: boolean,  // Newsletter, tips
  quietHoursStart: number,          // 22 (10 PM)
  quietHoursEnd: number,            // 8 (8 AM)
}
```

#### 4. Privacy Settings
```typescript
{
  privateProfile: boolean,          // Hide from search
  showRealName: boolean,            // Show display name publicly
  showTripHistory: boolean,         // Others can see past trips
  showActivityStatus: boolean,      // "Active now" indicator
  showLocation: boolean,            // Show current location
  allowLocationTracking: boolean,   // Track location for features
  disableFriendRequests: boolean,   // Block follow requests
}
```

#### 5. Account (Danger Zone)
- Change password (link to Supabase auth flow)
- Sign out of all devices
- Export my data (GDPR compliance)
- Delete account (requires confirmation)

---

## Implementation Steps

### Phase 1: Core Page Structure (Priority: P0)
1. Create `/app/profile/page.tsx` - server component to fetch user
2. Create `/app/profile/ProfileClient.tsx` - main client component
3. Update `MobileBottomNav.tsx` - Link Profile button to `/profile`
4. Create `components/profile/ProfileHeader.tsx` - avatar + name + stats

### Phase 2: Sections (Priority: P0)
5. Create `ProfileSection.tsx` - reusable expandable section
6. Implement Personal Info section with inline editing
7. Implement Travel Preferences section
8. Implement Notification Settings with toggles

### Phase 3: Settings & Account (Priority: P1)
9. Implement Privacy Settings section
10. Implement Account/Danger Zone section
11. Add sign out functionality
12. Add password change flow (Supabase)

### Phase 4: Polish (Priority: P2)
13. Avatar upload with crop/preview
14. Add skeleton loading states
15. Add success/error toasts
16. Mobile optimization pass

---

## API Endpoints Needed

### GET /api/profile
```typescript
// Fetch current user profile
Response: {
  user: {
    id, email, display_name, avatar_url, bio,
    home_country, home_city, date_of_birth, languages,
    preferences, notification_settings, privacy_settings,
    created_at, last_sign_in_at
  },
  stats: {
    tripsCount, countriesVisited, totalTravelDays
  }
}
```

### PATCH /api/profile
```typescript
// Update user profile
Body: Partial<UserProfile>
Response: { success: boolean, user: UserProfile }
```

### POST /api/profile/avatar
```typescript
// Upload avatar (use Supabase Storage)
Body: FormData with image
Response: { avatar_url: string }
```

### DELETE /api/profile/account
```typescript
// Delete user account
Body: { confirmation: "DELETE MY ACCOUNT" }
Response: { success: boolean }
```

---

## UX Considerations

### Mobile First (following Nielsen's heuristics)
- Touch targets >= 44px for all interactive elements
- Primary actions in bottom 1/3 (thumb zone)
- Use bottom sheets instead of modals where possible
- Swipe gestures for section navigation
- Pull-to-refresh for data sync

### Visibility of System Status
- Loading skeletons during data fetch
- Inline saving indicators ("Saving..." → "Saved ✓")
- Toast notifications for success/error

### Error Prevention
- Confirmation dialog for destructive actions (delete account)
- Validate inputs before saving
- Prevent accidental navigation with unsaved changes

### Consistency
- Reuse existing form patterns from trip creation
- Match card styling from trips list
- Use same color palette and spacing

---

## File Changes Summary

| Action | File | Description |
|--------|------|-------------|
| CREATE | `app/profile/page.tsx` | Server component |
| CREATE | `app/profile/ProfileClient.tsx` | Client component |
| CREATE | `components/profile/ProfileHeader.tsx` | Header section |
| CREATE | `components/profile/ProfileSection.tsx` | Expandable section |
| CREATE | `components/profile/PersonalInfoForm.tsx` | Personal info edit |
| CREATE | `components/profile/TravelPreferences.tsx` | Preferences section |
| CREATE | `components/profile/NotificationSettings.tsx` | Notification toggles |
| CREATE | `components/profile/PrivacySettings.tsx` | Privacy toggles |
| CREATE | `components/profile/AccountSettings.tsx` | Danger zone |
| CREATE | `app/api/profile/route.ts` | Profile API |
| CREATE | `app/api/profile/avatar/route.ts` | Avatar upload |
| MODIFY | `components/ui/MobileBottomNav.tsx` | Link to profile |

---

## Success Metrics

- [ ] User can view their profile information
- [ ] User can edit display name and bio
- [ ] User can update travel preferences
- [ ] User can toggle notification settings
- [ ] User can adjust privacy settings
- [ ] User can sign out
- [ ] User can delete their account
- [ ] All sections work on mobile (375px viewport)
- [ ] Loading states present for all async operations
- [ ] Error handling with helpful messages

---

## Sources

- [Profile page design examples with expert UX advice](https://www.eleken.co/blog-posts/profile-page-design)
- [Designing profile, account, and setting pages for better UX](https://medium.com/design-bootcamp/designing-profile-account-and-setting-pages-for-better-ux-345ef4ca1490)
- [How to Improve App Settings UX](https://www.toptal.com/designers/ux/settings-ux)
- [Mobile App Design Best Practices in 2025](https://wezom.com/blog/mobile-app-design-best-practices-in-2025)
- [Complete Guide to Profile UI Design](https://www.andacademy.com/resources/blog/ui-ux-design/profile-ui-design/)
