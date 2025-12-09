import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { nanoid } from "nanoid";
import type { TierLimits } from "@/lib/usage-limits/types";

/**
 * Test Account interface
 */
export interface TestAccount {
  id: string;
  user_id: string | null;
  email: string;
  temp_password: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  notes: string | null;
  custom_limits: Partial<TierLimits> | null;
}

/**
 * Generate a random password
 */
function generatePassword(length: number = 12): string {
  const charset = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

/**
 * Generate a test email
 */
function generateTestEmail(): string {
  const shortId = nanoid(8).toLowerCase();
  return `test-${shortId}@monkeytravel.test`;
}

/**
 * Verify admin access
 */
async function verifyAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized", status: 401 };
  }

  if (!isAdmin(user.email)) {
    return { error: "Forbidden", status: 403 };
  }

  return { user };
}

/**
 * GET /api/admin/test-accounts - List all test accounts
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await verifyAdmin(supabase);

    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Use admin client to bypass RLS (we've already verified admin access above)
    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("Failed to create admin client:", error);
      return NextResponse.json(
        { error: "Server configuration error: Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const { data, error } = await adminClient
      .from("test_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching test accounts:", error);
      return NextResponse.json(
        { error: "Failed to fetch test accounts: " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ accounts: data || [] });
  } catch (error) {
    console.error("Test accounts GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test accounts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/test-accounts - Create a new test account
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await verifyAdmin(supabase);

    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const {
      notes,
      expires_at,
      custom_limits,
    } = body;

    // Generate credentials
    const email = generateTestEmail();
    const password = generatePassword(12);

    // Create admin client for user creation
    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("Failed to create admin client:", error);
      return NextResponse.json(
        { error: "Server configuration error: Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Please add it to your Vercel environment." },
        { status: 500 }
      );
    }

    // Create the Supabase auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for test accounts
      user_metadata: {
        is_test_account: true,
        created_by: auth.user.email,
      },
    });

    if (authError || !authData.user) {
      console.error("Error creating auth user:", authError);
      return NextResponse.json(
        { error: authError?.message || "Failed to create auth user" },
        { status: 500 }
      );
    }

    // Wait a moment for the database trigger to create the users row
    // The trigger `on_auth_user_created` auto-creates the users profile
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Update the users table profile (trigger already created it)
    const { error: profileError } = await adminClient
      .from("users")
      .update({
        display_name: `Test User ${nanoid(4)}`,
        subscription_tier: custom_limits ? "premium" : "free", // Premium if custom limits
      })
      .eq("id", authData.user.id);

    if (profileError) {
      console.error("Error updating user profile:", profileError);
      // Clean up: delete the auth user
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: "Failed to update user profile: " + profileError.message },
        { status: 500 }
      );
    }

    // Create test account record
    const { data: testAccount, error: testError } = await adminClient
      .from("test_accounts")
      .insert({
        user_id: authData.user.id,
        email,
        temp_password: password, // Store for admin reference
        created_by: auth.user.email,
        notes: notes?.trim() || null,
        expires_at: expires_at || null,
        custom_limits: custom_limits || null,
        is_active: true,
      })
      .select()
      .single();

    if (testError) {
      console.error("Error creating test account record:", testError);
      // Clean up: delete the user and profile
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: "Failed to create test account record" },
        { status: 500 }
      );
    }

    console.log(`[Admin] Test account created by ${auth.user.email}: ${email}`);

    return NextResponse.json({
      success: true,
      account: testAccount,
    });
  } catch (error) {
    console.error("Test accounts POST error:", error);
    return NextResponse.json(
      { error: "Failed to create test account" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/test-accounts - Update a test account
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await verifyAdmin(supabase);

    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { id, is_active, notes, expires_at, custom_limits } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing account ID" }, { status: 400 });
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("Failed to create admin client:", error);
      return NextResponse.json(
        { error: "Server configuration error: Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }
    const updates: Record<string, unknown> = {};

    if (typeof is_active === "boolean") {
      updates.is_active = is_active;
    }

    if (notes !== undefined) {
      updates.notes = notes?.trim() || null;
    }

    if (expires_at !== undefined) {
      updates.expires_at = expires_at || null;
    }

    if (custom_limits !== undefined) {
      updates.custom_limits = custom_limits || null;
    }

    const { data, error } = await adminClient
      .from("test_accounts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating test account:", error);
      return NextResponse.json(
        { error: "Failed to update test account" },
        { status: 500 }
      );
    }

    console.log(`[Admin] Test account ${id} updated by ${auth.user.email}`);

    return NextResponse.json({
      success: true,
      account: data,
    });
  } catch (error) {
    console.error("Test accounts PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update test account" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/test-accounts - Delete a test account
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await verifyAdmin(supabase);

    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing account ID" }, { status: 400 });
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("Failed to create admin client:", error);
      return NextResponse.json(
        { error: "Server configuration error: Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // Get the test account first to get the user_id
    const { data: account, error: fetchError } = await adminClient
      .from("test_accounts")
      .select("user_id, email")
      .eq("id", id)
      .single();

    if (fetchError || !account) {
      return NextResponse.json(
        { error: "Test account not found" },
        { status: 404 }
      );
    }

    // Delete the auth user (cascades to users table and test_accounts)
    if (account.user_id) {
      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(
        account.user_id
      );

      if (deleteUserError) {
        console.error("Error deleting auth user:", deleteUserError);
        // Continue to delete the test account record anyway
      }
    }

    // Delete the test account record (in case cascade didn't work)
    const { error: deleteError } = await adminClient
      .from("test_accounts")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Error deleting test account record:", deleteError);
    }

    console.log(`[Admin] Test account ${account.email} deleted by ${auth.user.email}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Test accounts DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete test account" },
      { status: 500 }
    );
  }
}
