fix: make Supabase email a 6-digit code instead of a magic link

With `emailRedirectTo` set in the `signInWithOtp` options, Supabase treats the sign-in as a magic-link flow and emails a clickable sign-in URL instead of a plain 6-digit code. This removes `emailRedirectTo` from both the signup and the signin `otpOptions` in `handleSendOtp`, so both flows send the code. Not tested: request a code for a new and an existing account and check the email has a code, not a link.
