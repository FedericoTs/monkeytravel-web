# CRIT-001: Delete Account Implementation Plan

> **Priority:** Critical
> **Estimated Effort:** Medium (2-3 hours)
> **Status:** Planning Complete - Ready for Implementation

---

## 1. Problem Statement

The Delete Account button in the profile page (`app/profile/ProfileClient.tsx:758-768`) renders a fully styled button but has **no onClick handler**. Users can click it expecting account deletion, but nothing happens.

**Legal/Trust Impact:**
- Privacy Policy (line 110) promises: "You may request deletion of your account"
- GDPR compliance requires right to erasure
- User trust issue - broken UI promise

---

## 2. Current State Analysis

### 2.1 Button Location
```typescript
// app/profile/ProfileClient.tsx:758-768
<button className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-red-200 hover:border-red-300 hover:bg-red-50 transition-colors group">
  <div className="flex items-center gap-3">
    <svg>...</svg>
    <span className="font-medium text-red-600">Delete Account</span>
  </div>
  <svg>...</svg>
</button>
// NO onClick handler!
```

### 2.2 Existing Pattern (Sign Out Modal)
A confirmation modal already exists at lines 790-830 for sign out. We should follow the same pattern for consistency:
- State: `showSignOutConfirm`
- Modal with backdrop blur
- Cancel and Confirm buttons
- Animation classes

### 2.3 Database Tables with User Data

| Table | FK Column | Rows (typical) | Cascade Strategy |
|-------|-----------|----------------|------------------|
| `users` | `id` (PK) | 1 | Delete last (main record) |
| `trips` | `user_id` | 0-50 | Hard delete |
| `ai_conversations` | `user_id` | 0-20 | Hard delete |
| `ai_usage` | `user_id` | 0-100 | Hard delete |
| `user_usage` | `user_id` | 0-10 | Hard delete |
| `trip_checklists` | `user_id` | 0-50 | Hard delete |
| `activity_timelines` | `user_id` | 0-100 | Hard delete |
| `memories` | `user_id` | 0-50 | Hard delete |
| `expenses` | `user_id` | 0-20 | Hard delete |
| `notifications` | `user_id` | 0-50 | Hard delete |
| `search_history` | `user_id` | 0-100 | Hard delete |
| `travel_posts` | `user_id` | 0-20 | Hard delete |
| `user_favorites` | `user_id` | 0-20 | Hard delete |
| `user_visited_destinations` | `user_id` | 0-20 | Hard delete |
| `user_relationships` | `follower_id`, `following_id` | 0-50 | Hard delete |
| `trip_collaborators` | `user_id`, `invited_by` | 0-10 | Hard delete |
| `page_views` | `user_id` (nullable) | many | Set to NULL |
| `api_request_logs` | `user_id` (nullable) | many | Set to NULL |

### 2.4 Auth User Deletion
The `users` table has FK constraint: `users.id` → `auth.users.id`
Must delete `auth.users` record using Supabase Admin API (service role).

---

## 3. Technical Design

### 3.1 Architecture Overview

```
┌─────────────────────┐
│  ProfileClient.tsx  │
│  (Delete Button)    │
└─────────┬───────────┘
          │ onClick
          ▼
┌─────────────────────┐
│ DeleteAccountModal  │
│ (Confirmation UI)   │
└─────────┬───────────┘
          │ onConfirm
          ▼
┌─────────────────────┐
│ POST /api/profile   │
│ { action: 'delete' }│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Supabase Service    │
│ Role Client         │
│ - Delete user data  │
│ - Delete auth user  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Sign out & Redirect │
│ to landing page     │
└─────────────────────┘
```

### 3.2 API Endpoint Design

**Endpoint:** `DELETE /api/profile` or `POST /api/profile/delete`

**Request:**
```typescript
// No body needed - uses authenticated user from session
```

**Response (Success):**
```typescript
{
  success: true,
  message: "Account deleted successfully"
}
```

**Response (Error):**
```typescript
{
  error: "Failed to delete account",
  details?: string
}
```

### 3.3 Deletion Order (Critical for FK Constraints)

Must delete in reverse dependency order:

```sql
-- Phase 1: Delete records that reference user indirectly
DELETE FROM trip_checklists WHERE user_id = $1;
DELETE FROM activity_timelines WHERE user_id = $1;
DELETE FROM memories WHERE user_id = $1;
DELETE FROM expenses WHERE user_id = $1;
DELETE FROM notifications WHERE user_id = $1;
DELETE FROM search_history WHERE user_id = $1;
DELETE FROM travel_posts WHERE user_id = $1;
DELETE FROM user_favorites WHERE user_id = $1;
DELETE FROM user_visited_destinations WHERE user_id = $1;
DELETE FROM user_relationships WHERE follower_id = $1 OR following_id = $1;
DELETE FROM trip_collaborators WHERE user_id = $1 OR invited_by = $1;

-- Phase 2: Delete AI/usage records
DELETE FROM ai_conversations WHERE user_id = $1;
DELETE FROM ai_usage WHERE user_id = $1;
DELETE FROM user_usage WHERE user_id = $1;

-- Phase 3: Anonymize analytics (preserve data, remove PII)
UPDATE page_views SET user_id = NULL WHERE user_id = $1;
UPDATE api_request_logs SET user_id = NULL WHERE user_id = $1;

-- Phase 4: Delete trips (main content)
DELETE FROM trips WHERE user_id = $1;

-- Phase 5: Delete user profile
DELETE FROM users WHERE id = $1;

-- Phase 6: Delete auth user (via Admin API)
-- supabase.auth.admin.deleteUser(userId)
```

### 3.4 Security Considerations

1. **Authentication Required:** Must verify user is logged in
2. **Self-Deletion Only:** User can only delete their own account
3. **No Re-authentication:** Skip password re-entry (OAuth users may not have password)
4. **Rate Limiting:** Prevent abuse (one deletion per session)
5. **Soft Delete Option:** Consider keeping anonymized data for 30 days (future enhancement)
6. **Admin Protection:** Prevent admin users from deleting themselves (optional)

---

## 4. Implementation Steps

### Step 1: Create Delete Account Modal Component
**File:** `components/profile/DeleteAccountModal.tsx`

```typescript
interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}
```

**Features:**
- Warning icon and red color scheme
- Clear explanation of what will be deleted
- "Type DELETE to confirm" input for safety
- Cancel and Delete buttons
- Loading state during deletion

### Step 2: Create API Endpoint
**File:** `app/api/profile/delete/route.ts`

**Implementation:**
1. Verify authentication
2. Get user ID from session
3. Use service role client for deletion
4. Execute deletion in correct order
5. Call `supabase.auth.admin.deleteUser()`
6. Return success response

### Step 3: Update ProfileClient.tsx
**File:** `app/profile/ProfileClient.tsx`

**Changes:**
1. Add state: `showDeleteConfirm`, `isDeleting`
2. Add onClick handler to delete button
3. Import and render DeleteAccountModal
4. Handle deletion with loading state
5. Sign out and redirect on success

### Step 4: Handle Post-Deletion
- Clear local storage
- Sign out user
- Redirect to landing page with success message

---

## 5. File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `components/profile/DeleteAccountModal.tsx` | CREATE | Confirmation modal component |
| `app/api/profile/delete/route.ts` | CREATE | Deletion API endpoint |
| `app/profile/ProfileClient.tsx` | MODIFY | Add onClick, state, modal |
| `lib/supabase/admin.ts` | MODIFY (if needed) | Ensure admin client exists |

---

## 6. Testing Plan

### 6.1 Manual Testing
1. **Happy Path:** Click delete → Confirm → Account deleted → Redirected to home
2. **Cancel Flow:** Click delete → Cancel → Modal closes, no deletion
3. **Error Handling:** Simulate API failure → Error message shown
4. **UI State:** Loading spinner during deletion
5. **Post-Deletion:** Cannot log in with deleted account

### 6.2 Edge Cases
- User with 0 trips (empty account)
- User with many trips (50+ trips)
- User who is a trip collaborator
- OAuth user (no password)
- User during active trip

### 6.3 Database Verification
After deletion, verify:
- No records remain in any table with user_id
- Auth user removed from auth.users
- Shared trips become inaccessible
- Analytics records anonymized (user_id = NULL)

---

## 7. Rollback Plan

If issues discovered post-deployment:
1. Revert API endpoint (disable DELETE route)
2. Remove onClick handler from button
3. Data already deleted cannot be recovered (by design for GDPR)

**Future Enhancement:** Implement 30-day soft delete with recovery option

---

## 8. Success Criteria

- [ ] Delete button shows confirmation modal on click
- [ ] Modal clearly explains consequences
- [ ] "Type DELETE" confirmation prevents accidental deletion
- [ ] API deletes all user data in correct order
- [ ] Auth user removed from Supabase Auth
- [ ] User signed out and redirected to landing page
- [ ] Analytics data preserved but anonymized
- [ ] No orphaned records in database
- [ ] Error states handled gracefully

---

## 9. Code Templates

### 9.1 DeleteAccountModal Component Structure
```typescript
"use client";

import { useState } from "react";

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export default function DeleteAccountModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText === "DELETE";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl">
        {/* Warning Icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          {/* Trash icon */}
        </div>

        <h3 className="text-xl font-bold text-center text-slate-900 mb-2">
          Delete Account?
        </h3>

        <p className="text-slate-600 text-center mb-4">
          This will permanently delete your account and all associated data including:
        </p>

        <ul className="text-sm text-slate-500 mb-4 space-y-1">
          <li>• All your trips and itineraries</li>
          <li>• AI conversation history</li>
          <li>• Saved preferences and settings</li>
          <li>• Trip checklists and memories</li>
        </ul>

        <p className="text-red-600 text-sm font-medium text-center mb-4">
          This action cannot be undone.
        </p>

        {/* Confirmation Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Type <span className="font-mono bg-slate-100 px-1">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg"
            placeholder="DELETE"
            disabled={isDeleting}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 px-4 py-3 rounded-xl border-2"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canDelete || isDeleting}
            className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 9.2 API Endpoint Structure
```typescript
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function DELETE() {
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  // Create admin client for deletion
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // Delete in dependency order...
    // (implementation details)

    // Delete auth user
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteAuthError) throw deleteAuthError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account deletion failed:", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
```

---

## 10. Timeline

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Create DeleteAccountModal component | 20 min |
| 2 | Create API endpoint with deletion logic | 40 min |
| 3 | Update ProfileClient.tsx | 20 min |
| 4 | Testing & edge cases | 30 min |
| 5 | Documentation update | 10 min |
| **Total** | | **~2 hours** |

---

*Plan created: 2025-12-09*
*Ready for implementation approval*
