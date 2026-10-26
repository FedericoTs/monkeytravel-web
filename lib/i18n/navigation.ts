import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing-config";

// Navigation helpers that handle locale automatically. The app's Link is the
// wrapper in ./link, which decides when to prefetch.
export const { Link: NavigationLink, redirect, usePathname, useRouter } = createNavigation(routing);
