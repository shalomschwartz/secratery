"use client";

import { useEffect } from "react";

function isDarkHour() {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const apply = () => {
      if (isDarkHour()) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    apply();
    // Re-check every minute in case the threshold is crossed while the app is open
    const interval = setInterval(apply, 60_000);
    return () => clearInterval(interval);
  }, []);

  return <>{children}</>;
}
