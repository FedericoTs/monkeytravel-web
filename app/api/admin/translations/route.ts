import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import fs from "fs/promises";
import path from "path";

const MESSAGES_DIR = path.join(process.cwd(), "messages");
const SUPPORTED_LANGUAGES = ["en", "es", "it"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Read all translation files
 */
async function readTranslations(): Promise<Record<SupportedLanguage, Record<string, unknown>>> {
  const translations: Record<string, Record<string, unknown>> = {};

  for (const lang of SUPPORTED_LANGUAGES) {
    const filePath = path.join(MESSAGES_DIR, lang, "common.json");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      translations[lang] = JSON.parse(content);
    } catch (error) {
      console.error(`[Admin Translations] Failed to read ${lang}/common.json:`, error);
      translations[lang] = {};
    }
  }

  return translations as Record<SupportedLanguage, Record<string, unknown>>;
}

/**
 * Write translation file
 */
async function writeTranslation(
  lang: SupportedLanguage,
  data: Record<string, unknown>
): Promise<void> {
  const filePath = path.join(MESSAGES_DIR, lang, "common.json");
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Set a nested value in an object
 */
function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  value: string
): Record<string, unknown> {
  const keys = keyPath.split(".");
  const result = JSON.parse(JSON.stringify(obj));
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result;
}

/**
 * GET /api/admin/translations
 * Returns all translations for all languages
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

    const translations = await readTranslations();
    return apiSuccess({ translations });
  } catch (error) {
    console.error("[Admin Translations] Error reading translations:", error);
    return errors.internal("Failed to read translations", "Admin Translations");
  }
}

/**
 * PUT /api/admin/translations
 * Update a single translation key
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    if (!isAdmin(user.email)) {
      return errors.forbidden();
    }

    const body = await request.json();
    const { language, key, value } = body as {
      language: SupportedLanguage;
      key: string;
      value: string;
    };

    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return errors.badRequest("Invalid language");
    }

    if (!key || typeof value !== "string") {
      return errors.badRequest("Invalid key or value");
    }

    // Read current translations
    const translations = await readTranslations();

    // Update the specific key
    const updatedData = setNestedValue(translations[language], key, value);

    // Write back to file
    await writeTranslation(language, updatedData);

    // Log the change
    console.log(
      `[Admin Translations] ${user.email} updated ${language}:${key} = "${value.substring(0, 50)}..."`
    );

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Admin Translations] Error updating translation:", error);
    return errors.internal("Failed to update translation", "Admin Translations");
  }
}
