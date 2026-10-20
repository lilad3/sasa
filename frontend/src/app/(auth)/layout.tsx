import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell flex min-h-dvh items-center justify-center px-3 py-10 md:px-[18px] lg:px-5">
      <div className="w-full max-w-[480px]">{children}</div>
    </main>
  );
}
