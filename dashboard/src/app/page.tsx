import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  const requestedTheme = (await searchParams).theme;
  const theme = Array.isArray(requestedTheme)
    ? requestedTheme[0]
    : requestedTheme;

  // The desktop loading screen has already chosen the durable launch theme.
  // Carry that decision through this server redirect so the dashboard layout's
  // inline initializer can apply it before the first dashboard paint.
  redirect(
    theme === "dark" || theme === "light"
      ? `/dashboard?theme=${theme}`
      : "/dashboard",
  );
}
