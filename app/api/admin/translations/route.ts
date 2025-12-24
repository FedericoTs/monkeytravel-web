import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
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
      console.error(`Failed to read ${lang}/common.json:`, error);
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

    if (!user || !isAdmin(user.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const translations = await readTranslations();
    return NextResponse.json({ translations });
  } catch (error) {
    console.error("Failed to read translations:", error);
    return NextResponse.json(
      { error: "Failed to read translations" },
      { status: 500 }
    );
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

    if (!user || !isAdmin(user.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { language, key, value } = body as {
      language: SupportedLanguage;
      key: string;
      value: string;
    };

    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { error: "Invalid language" },
        { status: 400 }
      );
    }

    if (!key || typeof value !== "string") {
      return NextResponse.json(
        { error: "Invalid key or value" },
        { status: 400 }
      );
    }

    // Read current translations
    const translations = await readTranslations();

    // Update the specific key
    const updatedData = setNestedValue(translations[language], key, value);

    // Write back to file
    await writeTranslation(language, updatedData);

    // Log the change
    console.log(
      `[Translations] ${user.email} updated ${language}:${key} = "${value.substring(0, 50)}..."`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update translation:", error);
    return NextResponse.json(
      { error: "Failed to update translation" },
      { status: 500 }
    );
  }
}
