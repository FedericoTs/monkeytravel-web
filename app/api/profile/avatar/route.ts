import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { logReadError } from "@/lib/supabase/log-read-error";

export async function POST(request: Request) {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return errors.badRequest("No file provided");
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return errors.badRequest("Invalid file type. Allowed: JPEG, PNG, WebP, GIF");
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return errors.badRequest("File too large. Maximum size is 5MB");
    }

    // Generate unique filename
    const fileExt = file.name.split(".").pop() || "jpg";
    const fileName = `${user.id}/avatar-${Date.now()}.${fileExt}`;

    // Delete old avatar if exists
    const { data: userData } = logReadError("avatar: old file", await supabase
      .from("users")
      .select("avatar_url")
      .eq("id", user.id)
      .single());

    if (userData?.avatar_url) {
      // Extract old file path from URL
      const oldUrl = userData.avatar_url;
      const oldPath = oldUrl.split("/avatars/").pop();
      if (oldPath) {
        await supabase.storage.from("avatars").remove([oldPath]);
      }
    }

    // Convert File to ArrayBuffer then to Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Upload new avatar
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, uint8Array, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[Profile Avatar] Upload error:", uploadError);
      return errors.internal("Failed to upload avatar", "Profile Avatar");
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(uploadData.path);

    const avatarUrl = urlData.publicUrl;

    // Update user profile with new avatar URL
    const { error: updateError } = await supabase
      .from("users")
      .update({
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[Profile Avatar] Update error:", updateError);
      return errors.internal("Failed to update profile", "Profile Avatar");
    }

    return apiSuccess({
      success: true,
      avatar_url: avatarUrl,
    });
  } catch (error) {
    console.error("[Profile Avatar] Error in avatar upload:", error);
    return errors.internal("Internal server error", "Profile Avatar");
  }
}

export async function DELETE() {
  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get current avatar URL. The file is in a public bucket, so the avatar
    // is only gone once the file is: a failed read or removal stops here
    // rather than clear avatar_url and report a deletion that didn't happen.
    const { data: userData, error: readError } = await supabase
      .from("users")
      .select("avatar_url")
      .eq("id", user.id)
      .single();
    if (readError) {
      console.error("[Profile Avatar] profile read failed:", readError);
      return errors.internal("Failed to update profile", "Profile Avatar");
    }

    if (userData?.avatar_url) {
      // Extract file path from URL
      const oldPath = userData.avatar_url.split("/avatars/").pop();
      if (oldPath) {
        const { error: removeError } = await supabase.storage.from("avatars").remove([oldPath]);
        if (removeError) {
          console.error("[Profile Avatar] file removal failed:", removeError);
          return errors.internal("Failed to update profile", "Profile Avatar");
        }
      }
    }

    // Clear avatar_url in profile
    const { error: updateError } = await supabase
      .from("users")
      .update({
        avatar_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[Profile Avatar] Delete update error:", updateError);
      return errors.internal("Failed to update profile", "Profile Avatar");
    }

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Profile Avatar] Error in avatar delete:", error);
    return errors.internal("Internal server error", "Profile Avatar");
  }
}
